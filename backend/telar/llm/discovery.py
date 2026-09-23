"""Descubrimiento de los modelos disponibles de un proveedor LLM a partir de su API key."""

from __future__ import annotations

import logging

import httpx

from telar.custom_tools.http_tool import UnsafeURLError, check_url_is_safe
from telar.llm.registry import DEFAULT_BASE_URL

log = logging.getLogger(__name__)

_ANTHROPIC_BASE_URL = "https://api.anthropic.com"
_ANTHROPIC_VERSION = "2023-06-01"
_ANTHROPIC_MAX_PAGES = 5


class DiscoveryError(Exception):
    pass


async def list_models(provider: str, base_url: str | None, api_key: str | None) -> list[str]:
    if provider == "anthropic":
        return await _list_anthropic_models(base_url, api_key)

    url = (base_url or DEFAULT_BASE_URL.get(provider, "")).rstrip("/")
    if not url:
        raise DiscoveryError(f"proveedor desconocido: {provider!r}")

    # Guarda SSRF: el host lo elige un administrator de cuenta, no un operador confiable.
    try:
        check_url_is_safe(url)
    except UnsafeURLError as e:
        raise DiscoveryError(f"URL no permitida: {e}") from e

    try:
        async with httpx.AsyncClient(timeout=10) as client:
            if provider == "ollama":
                resp = await client.get(f"{url}/api/tags")
            else:
                headers = {"Authorization": f"Bearer {api_key}"} if api_key else {}
                resp = await client.get(f"{url}/models", headers=headers)
    except httpx.HTTPError as e:
        log.warning("descubrimiento de modelos falló para %s: %s", provider, e)
        raise DiscoveryError("No se pudo conectar con el proveedor.") from e

    if resp.status_code >= 400:
        raise DiscoveryError(f"El proveedor devolvió un error ({resp.status_code}).")

    data = resp.json()
    if provider == "ollama":
        return [m["name"] for m in data.get("models", [])]
    return [m["id"] for m in data.get("data", [])]


async def _list_anthropic_models(base_url: str | None, api_key: str | None) -> list[str]:
    if not api_key:
        raise DiscoveryError("Pegá la API key de Anthropic para descubrir sus modelos.")

    # LangChain usa la base sin /v1; se acepta también con /v1 por si la pegan así.
    url = (base_url or _ANTHROPIC_BASE_URL).rstrip("/").removesuffix("/v1")
    try:
        check_url_is_safe(url)
    except UnsafeURLError as e:
        raise DiscoveryError(f"URL no permitida: {e}") from e

    headers = {"x-api-key": api_key, "anthropic-version": _ANTHROPIC_VERSION}
    models: list[str] = []
    params: dict[str, str | int] = {"limit": 1000}
    try:
        async with httpx.AsyncClient(timeout=10) as client:
            for _ in range(_ANTHROPIC_MAX_PAGES):
                resp = await client.get(f"{url}/v1/models", headers=headers, params=params)
                if resp.status_code in (401, 403):
                    raise DiscoveryError("Anthropic rechazó la API key.")
                if resp.status_code >= 400:
                    raise DiscoveryError(f"Anthropic devolvió un error ({resp.status_code}).")
                data = resp.json()
                models.extend(m["id"] for m in data.get("data", []))
                if not data.get("has_more") or not data.get("last_id"):
                    break
                params = {"limit": 1000, "after_id": data["last_id"]}
    except httpx.HTTPError as e:
        log.warning("descubrimiento de modelos falló para anthropic: %s", e)
        raise DiscoveryError("No se pudo conectar con Anthropic.") from e
    return models
