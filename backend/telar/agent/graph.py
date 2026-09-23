"""
Grafo del agente.

build_graph() compila el JSON de bot_versions.graph si la cuenta tiene un
bot configurado (ver agent/compiler.py); si no, usa este grafo mínimo por
defecto -- un solo nodo con todas las tools, el mismo comportamiento que
tenía el v0 escrito a mano.
"""

from __future__ import annotations

from telar.agent.compiler import AgentState, compile_graph
from telar.agent.tools import consultar_base_de_conocimiento, escalar_a_humano

__all__ = ["AgentState", "TOOLS", "build_graph"]

TOOLS = [escalar_a_humano, consultar_base_de_conocimiento]

_DEFAULT_GRAPH_JSON = {
    "nodes": [{"id": "agente", "type": "agent"}],
    "edges": [{"from": "START", "to": "agente"}, {"from": "agente", "to": "END"}],
}


def build_graph(
    model_spec: str | None = None,
    model_kwargs: dict | None = None,
    checkpointer=None,
    extra_tools: list | None = None,
    graph_json: dict | None = None,
):
    tools = TOOLS + (extra_tools or [])
    return compile_graph(
        graph_json or _DEFAULT_GRAPH_JSON,
        available_tools=tools,
        model_spec=model_spec,
        model_kwargs=model_kwargs,
        checkpointer=checkpointer,
    )
