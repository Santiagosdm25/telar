"""
Compilador: traduce el JSON de bot_versions.graph a un StateGraph de
LangGraph real. El JSON es el contrato entre el futuro editor visual y el
runtime -- se puede escribir y probar a mano mucho antes de que exista
una sola interfaz.

Formato del JSON (v0, sin ramas condicionales):
    {
      "nodes": [{"id": "...", "type": "agent", "system_prompt": "...", "tools": [...] | null,
                 "memory_window": 20 | null}],
      "edges": [{"from": "START", "to": "..."}, {"from": "...", "to": "END"}]
    }

memory_window es opcional (default null = sin límite, todo el historial que
guarde el checkpointer de la conversación). Si se pone un número, el nodo
solo ve los últimos N mensajes del hilo al construir el prompt -- no borra
nada de lo guardado, solo acorta lo que se manda al modelo en ese turno.

Cada nodo "agent" hace su propio loop de tool-calling (como ya hacía el
grafo escrito a mano), y al terminar (sin más tool_calls) pasa al
siguiente nodo declarado en edges. v0 no soporta ramas: cada nodo tiene
como mucho un edge de salida.
"""

from __future__ import annotations

import logging
from typing import Annotated, Any, TypedDict

from langchain_core.messages import AnyMessage, SystemMessage
from langchain_core.tools import BaseTool
from langgraph.graph import END, START, StateGraph
from langgraph.graph.message import add_messages
from langgraph.prebuilt import ToolNode

from telar.llm.registry import get_model

log = logging.getLogger(__name__)


class AgentState(TypedDict):
    messages: Annotated[list[AnyMessage], add_messages]
    system_prompt: str
    account_id: str


class GraphCompileError(Exception):
    pass


def compile_graph(
    graph_json: dict[str, Any],
    available_tools: list[BaseTool],
    model_spec: str | None = None,
    model_kwargs: dict[str, Any] | None = None,
    checkpointer: Any = None,
):
    nodes = graph_json.get("nodes", [])
    edges = graph_json.get("edges", [])
    if not nodes:
        raise GraphCompileError("el grafo no tiene nodos")

    node_ids = {n["id"] for n in nodes}
    tools_by_name = {t.name: t for t in available_tools}

    start_targets = [e["to"] for e in edges if e["from"] == "START"]
    if len(start_targets) != 1:
        raise GraphCompileError("el grafo debe tener exactamente un edge desde START")
    start_node = start_targets[0]

    next_of: dict[str, str] = {}
    for e in edges:
        if e["from"] == "START":
            continue
        if e["from"] not in node_ids:
            raise GraphCompileError(f"edge sale de un nodo no declarado: {e['from']!r}")
        if e["to"] != "END" and e["to"] not in node_ids:
            raise GraphCompileError(f"edge apunta a un nodo no declarado: {e['to']!r}")
        if e["from"] in next_of:
            raise GraphCompileError(
                f"el nodo {e['from']!r} tiene más de un edge de salida (v0 no soporta ramas)"
            )
        next_of[e["from"]] = e["to"]

    graph = StateGraph(AgentState)

    for node in nodes:
        node_id = node["id"]
        if node.get("type") != "agent":
            raise GraphCompileError(f"tipo de nodo no soportado: {node.get('type')!r}")

        node_tools = _resolve_tools(node.get("tools"), available_tools, tools_by_name, node_id)
        next_id = next_of.get(node_id, "END")
        next_target = END if next_id == "END" else next_id

        graph.add_node(
            node_id,
            _make_agent_node(
                node.get("system_prompt"),
                node_tools,
                model_spec,
                model_kwargs,
                memory_window=node.get("memory_window"),
            ),
        )

        if node_tools:
            tools_id = f"{node_id}__tools"
            graph.add_node(tools_id, ToolNode(node_tools))
            graph.add_conditional_edges(
                node_id,
                _make_router(tools_id, next_target),
                {tools_id: tools_id, next_target: next_target},
            )
            graph.add_edge(tools_id, node_id)
        else:
            graph.add_edge(node_id, next_target)

    graph.add_edge(START, start_node)
    return graph.compile(checkpointer=checkpointer)


def _resolve_tools(
    names: list[str] | None,
    available_tools: list[BaseTool],
    tools_by_name: dict[str, BaseTool],
    node_id: str,
) -> list[BaseTool]:
    if names is None:
        return available_tools

    resolved = []
    for name in names:
        tool = tools_by_name.get(name)
        if tool is None:
            log.warning("nodo %s: tool desconocida %r, se ignora", node_id, name)
            continue
        resolved.append(tool)
    return resolved


def _make_agent_node(
    system_prompt: str | None,
    tools: list[BaseTool],
    model_spec: str | None,
    model_kwargs: dict[str, Any] | None = None,
    memory_window: int | None = None,
):
    model = get_model(model_spec, **(model_kwargs or {}))
    bound_model = model.bind_tools(tools) if tools else model

    async def agent(state: AgentState):
        prompt = system_prompt or state["system_prompt"]
        history = state["messages"]
        # memory_window acorta lo que ve el modelo, no lo que guarda el
        # checkpointer -- restaurar el nodo a "sin límite" recupera el
        # historial completo sin perder nada de lo ya conversado.
        if memory_window is not None and memory_window >= 0:
            history = history[-memory_window:] if memory_window > 0 else []
        messages = [SystemMessage(content=prompt), *history]
        try:
            reply = await bound_model.ainvoke(messages)
        except Exception as e:
            # No cambia el reintento (ya correcto: worker/dispatcher.py
            # deja el mensaje en el buffer y el próximo intento dedupea
            # sin volver a llamar al LLM) -- esto solo evita que quede
            # enterrado un stack trace de LangChain en vez de una línea
            # que diga qué cuenta necesita un proveedor LLM configurado.
            log.error(
                "el modelo del agente falló para la cuenta %s: %s", state["account_id"], e
            )
            raise
        return {"messages": [reply]}

    return agent


def _make_router(tools_dest: str, next_dest: str):
    def route(state: AgentState):
        last = state["messages"][-1]
        return tools_dest if getattr(last, "tool_calls", None) else next_dest

    return route
