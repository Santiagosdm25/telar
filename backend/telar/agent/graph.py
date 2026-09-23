"""Grafo del agente: el bot de la cuenta si tiene uno, si no un nodo único con todas las tools."""

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
