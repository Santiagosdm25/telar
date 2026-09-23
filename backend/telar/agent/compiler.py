"""Compila el JSON de bot_versions.graph a un StateGraph de LangGraph.

v2 (`"version": 2`): ver agent/multi_agent.py. v1 (sin `version`), cadena lineal:
    {
      "nodes": [{"id": "...", "type": "agent", "system_prompt": "...", "tools": [...] | null,
                 "memory_window": 20 | null}],
      "edges": [{"from": "START", "to": "..."}, {"from": "...", "to": "END"}]
    }
"""

from __future__ import annotations

import logging
from typing import Annotated, Any, TypedDict

from langchain_core.messages import AnyMessage, HumanMessage, SystemMessage, ToolMessage
from langchain_core.runnables import RunnableConfig
from langchain_core.tools import BaseTool
from langgraph.graph import END, START, StateGraph
from langgraph.graph.message import add_messages
from langgraph.prebuilt import ToolNode

from telar.agent import trace
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
    if graph_json.get("version") == 2:

        from telar.agent.multi_agent import compile_multi_agent

        return compile_multi_agent(
            graph_json, available_tools, model_spec, model_kwargs, checkpointer
        )

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
            make_agent_node(
                node.get("system_prompt"),
                node_tools,
                model_spec,
                model_kwargs,
                memory_window=node.get("memory_window"),
                agent_id=node_id,
            ),
        )

        if node_tools:
            tools_id = f"{node_id}__tools"
            graph.add_node(tools_id, make_tools_node(node_tools, agent_id=node_id))
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


def message_text(message: AnyMessage) -> str:
    """Texto del mensaje; con Anthropic `content` puede ser una lista de bloques."""
    content = message.content
    if isinstance(content, str):
        return content
    parts = []
    for block in content:
        if isinstance(block, str):
            parts.append(block)
        elif isinstance(block, dict) and block.get("type") == "text":
            parts.append(block.get("text", ""))
    return "".join(parts)


def tool_called_this_turn(messages: list[AnyMessage], tool_name: str) -> bool:
    """¿Se ejecutó `tool_name` después del último mensaje del cliente?"""
    for message in reversed(messages):
        if isinstance(message, HumanMessage):
            return False
        if isinstance(message, ToolMessage) and message.name == tool_name:
            return True
    return False


def trim_history(history: list[AnyMessage], memory_window: int | None) -> list[AnyMessage]:
    """Últimos `memory_window` mensajes, empezando en un mensaje del cliente.

    Un ToolMessage sin su llamada al inicio hace que los proveedores respondan 400.
    """
    if memory_window is None:
        return history
    window = history[-max(memory_window, 1):]
    for i, message in enumerate(window):
        if isinstance(message, HumanMessage):
            return window[i:]
    # La ventana quedó dentro de un turno con herramientas: se retrocede al último
    # mensaje del cliente.
    for i in range(len(history) - 1, -1, -1):
        if isinstance(history[i], HumanMessage):
            return history[i:]
    return window


def make_agent_node(
    system_prompt: str | None,
    tools: list[BaseTool],
    model_spec: str | None,
    model_kwargs: dict[str, Any] | None = None,
    memory_window: int | None = None,
    agent_id: str = "agente",
):
    model = get_model(model_spec, **(model_kwargs or {}))
    bound_model = model.bind_tools(tools) if tools else model

    async def agent(state: AgentState):
        prompt = system_prompt or state["system_prompt"]
        # Solo acorta lo que ve el modelo; el checkpointer conserva todo.
        history = trim_history(state["messages"], memory_window)
        messages = [SystemMessage(content=prompt), *history]
        try:
            reply = await bound_model.ainvoke(messages)
        except Exception as e:
            log.error(
                "el modelo del agente falló para la cuenta %s: %s", state["account_id"], e
            )
            trace.record(agent=agent_id, kind="error", text=trace.clip(e))
            raise

        if trace.enabled():
            for call in getattr(reply, "tool_calls", None) or []:
                trace.record(
                    agent=agent_id, kind="tool_call", name=call["name"], args=call.get("args", {})
                )
            text = message_text(reply)
            if text.strip():
                trace.record(agent=agent_id, kind="message", text=trace.clip(text))
        return {"messages": [reply]}

    return agent


def make_tools_node(tools: list[BaseTool], agent_id: str):
    """ToolNode + registro en la traza de lo que devolvió cada herramienta."""
    tool_node = ToolNode(tools)

    async def run_tools(state: AgentState, config: RunnableConfig):
        result = await tool_node.ainvoke(state, config)
        if trace.enabled():
            for message in result.get("messages", []):
                trace.record(
                    agent=agent_id,
                    kind="tool_result",
                    name=message.name,
                    text=trace.clip(message.content),
                    error=getattr(message, "status", None) == "error",
                )
        return result

    return run_tools


def _make_router(tools_dest: str, next_dest: str):
    def route(state: AgentState):
        last = state["messages"][-1]
        return tools_dest if getattr(last, "tool_calls", None) else next_dest

    return route
