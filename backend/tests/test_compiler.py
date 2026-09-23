"""
Tests del compilador de grafos. Modelos y tools falsos, sin red/DB/LLM
real -- valida la estructura del StateGraph resultante y los errores de
validación.
"""

from __future__ import annotations

from unittest.mock import patch

import pytest
from langchain_core.messages import AIMessage, HumanMessage
from langchain_core.tools import tool

import telar.agent.compiler as compiler_mod
from telar.agent.compiler import GraphCompileError, compile_graph


@tool
def fake_tool(x: str) -> str:
    """Tool de prueba."""
    return f"resultado de {x}"


ALL_TOOLS = [fake_tool]


class _FakeBoundModel:
    """Simula un modelo: primera llamada del nodo pide la tool, la segunda responde."""

    def __init__(self, node_id: str, calls: list[str]):
        self.node_id = node_id
        self.calls = calls

    async def ainvoke(self, messages):
        self.calls.append(self.node_id)
        already_called = any(getattr(m, "name", None) == "fake_tool" for m in messages)
        if self.node_id == "extractor" and not already_called:
            return AIMessage(
                content="",
                tool_calls=[{"name": "fake_tool", "args": {"x": "test"}, "id": "1", "type": "tool_call"}],
            )
        return AIMessage(content=f"respuesta de {self.node_id}")


class _FakeModel:
    """
    Modelo falso. ainvoke() propio para el caso de un nodo sin tools
    (bind_tools() nunca se llama, así que hace falta el mismo
    comportamiento directo sobre la instancia).
    """

    def __init__(self, calls: list[str]):
        self.calls = calls
        self._node_id = "?"

    def bind_tools(self, tools):
        return _FakeBoundModel(self._node_id, self.calls)

    async def ainvoke(self, messages):
        return await _FakeBoundModel(self._node_id, self.calls).ainvoke(messages)


def _patched_get_model(calls: list[str], node_ids_in_order: list[str]):
    """get_model() se llama una vez por nodo, en el orden en que se declaran."""
    state = {"i": 0}

    def _get_model(model_spec=None):
        m = _FakeModel(calls)
        m._node_id = node_ids_in_order[state["i"]]
        state["i"] += 1
        return m

    return _get_model


def _base_state(text: str = "hola"):
    return {"messages": [HumanMessage(content=text)], "system_prompt": "sos un bot", "account_id": "x"}


def test_default_single_node_graph_compiles_and_runs():
    graph_json = {
        "nodes": [{"id": "agente", "type": "agent"}],
        "edges": [{"from": "START", "to": "agente"}, {"from": "agente", "to": "END"}],
    }
    calls: list[str] = []
    with patch.object(compiler_mod, "get_model", _patched_get_model(calls, ["agente"])):
        app = compile_graph(graph_json, ALL_TOOLS)
        import asyncio

        result = asyncio.run(app.ainvoke(_base_state()))
    assert result["messages"][-1].content == "respuesta de agente"


def test_two_node_chain_runs_in_order_with_tool_loop():
    graph_json = {
        "nodes": [
            {"id": "extractor", "type": "agent", "tools": ["fake_tool"]},
            {"id": "respondedor", "type": "agent", "tools": []},
        ],
        "edges": [
            {"from": "START", "to": "extractor"},
            {"from": "extractor", "to": "respondedor"},
            {"from": "respondedor", "to": "END"},
        ],
    }
    calls: list[str] = []
    with patch.object(
        compiler_mod, "get_model", _patched_get_model(calls, ["extractor", "respondedor"])
    ):
        app = compile_graph(graph_json, ALL_TOOLS)
        import asyncio

        result = asyncio.run(app.ainvoke(_base_state()))

    # extractor se llama dos veces (pide la tool, después responde con el resultado),
    # respondedor se llama una vez, en ese orden.
    assert calls == ["extractor", "extractor", "respondedor"]
    assert result["messages"][-1].content == "respuesta de respondedor"


def test_unknown_node_type_raises():
    graph_json = {
        "nodes": [{"id": "x", "type": "condition"}],
        "edges": [{"from": "START", "to": "x"}, {"from": "x", "to": "END"}],
    }
    with pytest.raises(GraphCompileError):
        compile_graph(graph_json, ALL_TOOLS)


def test_edge_to_undeclared_node_raises():
    graph_json = {
        "nodes": [{"id": "a", "type": "agent"}],
        "edges": [{"from": "START", "to": "a"}, {"from": "a", "to": "no_existe"}],
    }
    with pytest.raises(GraphCompileError):
        compile_graph(graph_json, ALL_TOOLS)


def test_missing_start_edge_raises():
    graph_json = {"nodes": [{"id": "a", "type": "agent"}], "edges": [{"from": "a", "to": "END"}]}
    with pytest.raises(GraphCompileError):
        compile_graph(graph_json, ALL_TOOLS)


def test_multiple_start_edges_raises():
    graph_json = {
        "nodes": [{"id": "a", "type": "agent"}, {"id": "b", "type": "agent"}],
        "edges": [
            {"from": "START", "to": "a"},
            {"from": "START", "to": "b"},
            {"from": "a", "to": "END"},
            {"from": "b", "to": "END"},
        ],
    }
    with pytest.raises(GraphCompileError):
        compile_graph(graph_json, ALL_TOOLS)


def test_node_with_two_outgoing_edges_raises():
    graph_json = {
        "nodes": [{"id": "a", "type": "agent"}, {"id": "b", "type": "agent"}, {"id": "c", "type": "agent"}],
        "edges": [
            {"from": "START", "to": "a"},
            {"from": "a", "to": "b"},
            {"from": "a", "to": "c"},
        ],
    }
    with pytest.raises(GraphCompileError):
        compile_graph(graph_json, ALL_TOOLS)


def test_unknown_tool_name_is_skipped_not_raised():
    graph_json = {
        "nodes": [{"id": "agente", "type": "agent", "tools": ["fake_tool", "no_existe"]}],
        "edges": [{"from": "START", "to": "agente"}, {"from": "agente", "to": "END"}],
    }
    calls: list[str] = []
    with patch.object(compiler_mod, "get_model", _patched_get_model(calls, ["agente", "agente"])):
        # No debe lanzar, solo loguear un warning e ignorar el nombre desconocido.
        compile_graph(graph_json, ALL_TOOLS)
