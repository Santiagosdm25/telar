"""
Caché de grafos compilados por cuenta.

Un grafo por cuenta: cada una puede tener sus propias tools configurables, y
bind_tools() necesita conocer la lista completa de antemano (compiler.py la
"hornea" en el modelo al compilar). Antes este caché vivía como atributo de
instancia de Pipeline (worker/pipeline.py), en un proceso que no tenía
ninguna referencia al router que guarda bot_versions o al que administra
tools/KBs -- por eso una tool nueva no se veía sin reiniciar el proceso.

Vivir a nivel de módulo permite que cualquier código que mute lo que el
grafo compilado ve (guardar un bot_version, activar otra versión, crear o
editar una tool, tocar una base de conocimiento) llame invalidate() sin
necesitar una referencia al Pipeline en ejecución.

El objeto compilado en sí (un StateGraph con modelos ya enlazados) no es
serializable para compartirlo entre procesos -- lo que sí se comparte es
de qué versión es, en account_graph_versions (Postgres). Cada proceso
sigue cacheando su propio grafo compilado localmente, pero lo valida
contra esa versión compartida en cada uso: si otro proceso invalidó la
cuenta, la próxima get_or_build() de cualquier proceso lo detecta solo,
sin que invalidate() necesite avisarle a nadie directamente.
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
    """Si la cuenta tiene un proveedor LLM activo, se usa ese en vez del
    modelo global por defecto. Sin proveedor activo, el comportamiento es
    exactamente el de antes (None -> settings().default_model)."""
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
