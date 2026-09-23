"""
Registro de modelos. No construimos abstracción propia: init_chat_model de
LangChain ya resuelve el multi-proveedor con la cadena "proveedor:modelo".
"""

from __future__ import annotations

from functools import lru_cache
from typing import Any

from langchain.chat_models import init_chat_model

from telar.config import settings

# init_chat_model solo reconoce los proveedores que LangChain empaqueta
# (openai, anthropic, ollama...). OpenRouter no es uno de ellos, pero expone
# una API compatible con la de OpenAI -- se resuelve como "openai" apuntando
# a la base_url de OpenRouter en vez de necesitar un paquete que no existe
# (langchain-openrouter).
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
    """
    spec admite "anthropic:claude-sonnet-4-5", "openai:gpt-4.1",
    "ollama:llama3.1" -- el proveedor tiene que ser uno de los que
    reconoce init_chat_model (ver LANGCHAIN_PROVIDER_ALIAS para casos como
    OpenRouter). La base_url va en params si no es la del proveedor por
    defecto.
    """
    spec = spec or settings().default_model
    return _cached(spec, tuple(sorted(params.items())))


def resolve_model_spec(
    provider: str, model: str, base_url: str | None = None
) -> tuple[str, str | None]:
    """Traduce (proveedor de la cuenta, modelo) al spec que espera
    init_chat_model, y resuelve la base_url por defecto del proveedor si no
    vino una explícita."""
    langchain_provider = LANGCHAIN_PROVIDER_ALIAS.get(provider, provider)
    resolved_base_url = base_url or DEFAULT_BASE_URL.get(provider)
    return f"{langchain_provider}:{model}", resolved_base_url
