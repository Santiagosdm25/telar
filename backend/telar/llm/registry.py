"""Registro de modelos sobre init_chat_model ("proveedor:modelo")."""

from __future__ import annotations

from functools import lru_cache
from typing import Any

from langchain.chat_models import init_chat_model

from telar.config import settings

# OpenRouter no es un proveedor de init_chat_model, pero su API es compatible
# con OpenAI: se resuelve como "openai" con su base_url.
LANGCHAIN_PROVIDER_ALIAS = {"openrouter": "openai"}

DEFAULT_BASE_URL = {
    "openai": "https://api.openai.com/v1",
    "openrouter": "https://openrouter.ai/api/v1",
    "ollama": "http://localhost:11434",
}


@lru_cache(maxsize=32)
def _cached(spec: str, frozen_params: tuple) -> Any:
    return init_chat_model(spec, **dict(frozen_params))


def get_model(spec: str | None = None, **params: Any):
    """spec: "anthropic:claude-sonnet-4-5", "openai:gpt-4.1", "ollama:llama3.1"..."""
    spec = spec or settings().default_model
    return _cached(spec, tuple(sorted(params.items())))


def resolve_model_spec(
    provider: str, model: str, base_url: str | None = None
) -> tuple[str, str | None]:
    """(proveedor de la cuenta, modelo) -> spec de init_chat_model y base_url por defecto."""
    langchain_provider = LANGCHAIN_PROVIDER_ALIAS.get(provider, provider)
    resolved_base_url = base_url or DEFAULT_BASE_URL.get(provider)
    return f"{langchain_provider}:{model}", resolved_base_url
