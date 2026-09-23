"""Caché por proceso de grafos compilados por cuenta.

El grafo compilado no es serializable; lo que se comparte entre procesos es su versión
(account_graph_versions) y get_or_build() la valida en cada uso.
"""

from __future__ import annotations

from uuid import UUID

from telar.agent.graph import build_graph
from telar.core import crypto
from telar.custom_tools.loader import build_custom_tools
from telar.db import repositories as repo
from telar.llm.registry import resolve_model_spec

_graphs: dict[str, tuple[int, object]] = {}


async def get_or_build(account_id: UUID, checkpointer) -> object:
    key = str(account_id)
    current_version = await repo.get_graph_version(account_id)

    cached = _graphs.get(key)
    if cached is None or cached[0] != current_version:
        extra_tools = await build_custom_tools(account_id)
        graph_json = await repo.get_active_bot_graph(account_id)
        model_spec, model_kwargs = await _resolve_model(account_id)
        graph = build_graph(
            model_spec=model_spec,
            model_kwargs=model_kwargs,
            checkpointer=checkpointer,
            extra_tools=extra_tools,
            graph_json=graph_json,
        )
        _graphs[key] = (current_version, graph)

    return _graphs[key][1]


async def _resolve_model(account_id: UUID) -> tuple[str | None, dict]:
    """Proveedor LLM activo de la cuenta; sin él, None -> settings().default_model."""
    provider = await repo.get_active_llm_provider(account_id)
    if provider is None:
        return None, {}

    model_spec, base_url = resolve_model_spec(
        provider["provider"], provider["model"], provider["base_url"]
    )
    kwargs: dict = {}
    if base_url:
        kwargs["base_url"] = base_url
    if provider["api_key"]:
        kwargs["api_key"] = crypto.decrypt(bytes(provider["api_key"]).decode())
    return model_spec, kwargs


async def invalidate(account_id: UUID) -> None:
    await repo.bump_graph_version(account_id)
