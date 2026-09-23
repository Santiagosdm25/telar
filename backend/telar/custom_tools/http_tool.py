"""
Tool HTTP configurable por cuenta.

Los argumentos que decide el LLM van como query params (GET/DELETE) o
body JSON (POST/PUT/PATCH) -- nunca interpolados en la URL vía template,
así se evita esa clase de problema por completo.
"""

from __future__ import annotations

import ipaddress
import logging
import socket
from typing import Any
from urllib.parse import urlparse

import httpx
from langchain_core.tools import StructuredTool

from telar.custom_tools.schema import build_args_model

log = logging.getLogger(__name__)

_ALLOWED_SCHEMES = {"http", "https"}
_MAX_RESPONSE_CHARS = 4000


class UnsafeURLError(Exception):
    pass


def _is_blocked_ip(ip: str) -> bool:
    addr = ipaddress.ip_address(ip)
    return (
        addr.is_private
        or addr.is_loopback
        or addr.is_link_local
        or addr.is_multicast
        or addr.is_reserved
        or addr.is_unspecified
    )


def check_url_is_safe(url: str) -> None:
    """
    Guarda SSRF: resuelve el host y rechaza si alguna IP resuelta cae en un
    rango privado/loopback/link-local/reservado. Se corre en cada llamada,
    no solo al guardar la config -- defensa básica contra DNS rebinding.
    No pinnea la IP resuelta para la conexión real: límite documentado de
    v0, no un transporte con IP pinneada.
    """
    parsed = urlparse(url)
    if parsed.scheme not in _ALLOWED_SCHEMES:
        raise UnsafeURLError(f"esquema no permitido: {parsed.scheme!r}")
    if not parsed.hostname:
        raise UnsafeURLError("URL sin host")

    try:
        infos = socket.getaddrinfo(parsed.hostname, None)
    except socket.gaierror as e:
        raise UnsafeURLError(f"no se pudo resolver el host: {e}") from e

    for info in infos:
        ip = info[4][0]
        if _is_blocked_ip(ip):
            raise UnsafeURLError(f"IP no permitida para {parsed.hostname}: {ip}")


def build_http_tool(row: dict[str, Any], secret: dict[str, Any]) -> StructuredTool:
    config = row["config"]
    url = config["url"]
    method = config.get("method", "GET").upper()
    timeout = config.get("timeout_seconds", 10)
    headers = secret.get("headers", {})

    args_model = build_args_model(row["schema"], model_name=f"{row['name']}_args")

    async def _run(**kwargs: Any) -> str:
        # ToolNode no atrapa excepciones arbitrarias por default (solo
        # ToolInvocationError): sin este try/except, una API externa caída
        # o una URL bloqueada tumbaría el turno completo del agente.
        try:
            check_url_is_safe(url)

            async with httpx.AsyncClient(timeout=timeout) as client:
                if method in ("GET", "DELETE"):
                    resp = await client.request(method, url, params=kwargs, headers=headers)
                else:
                    resp = await client.request(method, url, json=kwargs, headers=headers)
        except UnsafeURLError as e:
            log.error("tool %s: URL bloqueada (%s)", row["name"], e)
            return "Esta herramienta está mal configurada y no se puede usar."
        except Exception:
            log.exception("tool %s: fallo llamando a la API externa", row["name"])
            return "No se pudo consultar la herramienta externa en este momento."

        if resp.status_code >= 400:
            log.warning("tool %s: la API externa devolvió %s", row["name"], resp.status_code)
            return f"La herramienta externa devolvió un error ({resp.status_code})."

        return resp.text[:_MAX_RESPONSE_CHARS]

    return StructuredTool.from_function(
        coroutine=_run,
        name=row["name"],
        description=row["description"],
        args_schema=args_model,
    )
