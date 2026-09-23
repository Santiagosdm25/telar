from __future__ import annotations

import httpx
import pytest

from telar.llm import discovery
from telar.llm.discovery import DiscoveryError, list_models


def _mock_client(monkeypatch, handler):
    real = httpx.AsyncClient
    monkeypatch.setattr(
        discovery.httpx, "AsyncClient", lambda **kw: real(transport=httpx.MockTransport(handler), **kw)
    )
    monkeypatch.setattr(discovery, "check_url_is_safe", lambda url: None)


async def test_anthropic_lista_modelos_de_la_api_con_paginado(monkeypatch):
    seen = []

    def handler(request: httpx.Request) -> httpx.Response:
        seen.append(request)
        if "after_id" not in request.url.params:
            return httpx.Response(
                200, json={"data": [{"id": "claude-opus-5-5"}], "has_more": True, "last_id": "a"}
            )
        return httpx.Response(200, json={"data": [{"id": "claude-haiku-4-5"}], "has_more": False})

    _mock_client(monkeypatch, handler)
    models = await list_models("anthropic", None, "sk-ant-test")

    assert models == ["claude-opus-5-5", "claude-haiku-4-5"]
    first = seen[0]
    assert str(first.url).startswith("https://api.anthropic.com/v1/models")
    assert first.headers["x-api-key"] == "sk-ant-test"
    assert first.headers["anthropic-version"] == "2023-06-01"
    assert "authorization" not in first.headers
    assert seen[1].url.params["after_id"] == "a"


async def test_anthropic_acepta_base_url_con_v1(monkeypatch):
    urls = []

    def handler(request: httpx.Request) -> httpx.Response:
        urls.append(str(request.url))
        return httpx.Response(200, json={"data": [], "has_more": False})

    _mock_client(monkeypatch, handler)
    await list_models("anthropic", "https://proxy.ejemplo.com/v1/", "k")
    assert urls[0].startswith("https://proxy.ejemplo.com/v1/models")


async def test_anthropic_key_invalida(monkeypatch):
    _mock_client(monkeypatch, lambda request: httpx.Response(401, json={"type": "error"}))
    with pytest.raises(DiscoveryError, match="rechazó la API key"):
        await list_models("anthropic", None, "mala")


async def test_anthropic_sin_key():
    with pytest.raises(DiscoveryError, match="API key"):
        await list_models("anthropic", None, None)
