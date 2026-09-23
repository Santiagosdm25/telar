"""
Descubrimiento de modelos disponibles para un proveedor LLM, dado su API key
-- así el picker de la cuenta se llena con datos reales en vez de una lista
escrita a mano que se desactualiza.
"""

from __future__ import annotations

import logging

import httpx

from telar.custom_tools.http_tool import UnsafeURLError, check_url_is_safe
from telar.llm.registry import DEFAULT_BASE_URL

log = logging.getLogger(__name__)

# Anthropic no tiene un endpoint público de listado de modelos: se mantiene
# una lista fija, igual que hace cualquier integración con esta API.
_ANTHROPIC_MODELS = [
    "claude-opus-4-1",
    "claude-sonnet-4-5",
    "claude-haiku-4-5",
]


class DiscoveryError(Exception):
    pass


async def list_models(provider: str, base_url: str | None, api_key: str | None) -> list[str]:
    if provider == "anthropic":
        return _ANTHROPIC_MODELS

    url = (base_url or DEFAULT_BASE_URL.get(provider, "")).rstrip("/")
    if not url:
        raise DiscoveryError(f"proveedor desconocido: {provider!r}")

    # Mismo guard SSRF que ya protege las tools HTTP configurables (resuelve
    # DNS, bloquea IPs privadas/loopback/link-local/metadata de nube) -- acá
    # el host lo elige un administrator de cuenta, no un operador confiable.
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
