"""
Tests del formato v2 (agente principal + sub-agentes) y de los helpers del
compilador que lo sostienen. Modelo y tools falsos: sin red, DB ni LLM real.
"""

from __future__ import annotations

from unittest.mock import patch

import pytest
from langchain_core.messages import AIMessage, HumanMessage, SystemMessage, ToolMessage
from langchain_core.tools import tool

import telar.agent.compiler as compiler_mod
from telar.agent import trace
from telar.agent.compiler import (
    GraphCompileError,
    compile_graph,
    message_text,
    tool_called_this_turn,
    trim_history,
)


@tool
def consultar_registro(documento: str) -> str:
    """Consulta el registro de identidad."""
    return f"documento {documento}: vigente, nombre Ana Pérez"


@tool
def escalar_a_humano(motivo: str) -> str:
    """Transfiere a un asesor."""
    return "TRANSFERIR: " + motivo


TOOLS = [consultar_registro, escalar_a_humano]


def _tool_result(messages, name: str) -> str | None:
    for m in messages:
        if isinstance(m, ToolMessage) and m.name == name:
            return str(m.content)
    return None


def _call(name: str, args: dict, call_id: str) -> AIMessage:
    return AIMessage(
        content="", tool_calls=[{"name": name, "args": args, "id": call_id, "type": "tool_call"}]
    )


class _ScriptedModel:
    """
    Decide según quién lo llama (el prompt del sub-agente trae el contrato
    "Trabajás para otro agente"): el principal delega una vez y después
    responde con lo que devolvió el sub-agente; el sub-agente consulta el
    registro una vez y después informa el resultado.
    """

    def __init__(self, prompts_seen: list[str]):
        self.prompts_seen = prompts_seen

    def bind_tools(self, tools):
        return self

    async def ainvoke(self, messages):
        prompt = str(messages[0].content) if isinstance(messages[0], SystemMessage) else ""
        self.prompts_seen.append(prompt)
        if "Trabajás para otro agente" in prompt:
            found = _tool_result(messages, "consultar_registro")
            if found is None:
                return _call("consultar_registro", {"documento": "123"}, "sub-1")
            return AIMessage(content=f"Identidad validada ({found})")
        delegated = _tool_result(messages, "delegar_validar_identidad")
        if delegated is None:
            return _call("delegar_validar_identidad", {"tarea": "validar documento 123"}, "main-1")
        return AIMessage(content=f"Listo. {delegated}")


def _graph(**overrides) -> dict:
    main = {
        "id": "principal",
        "role": "main",
        "name": "Agente principal",
        "system_prompt": "Atendés clientes.",
        "tools": ["escalar_a_humano"],
        "subagents": ["validar_identidad"],
    }
    sub = {
        "id": "validar_identidad",
        "role": "sub",
        "name": "Validar identidad",
        "description": "Valida la identidad del cliente con su documento.",
        "system_prompt": "Validás identidades.",
        "tools": ["consultar_registro"],
    }
    main.update(overrides.pop("main", {}))
    sub.update(overrides.pop("sub", {}))
    return {"version": 2, "agents": [main, sub], "layout": {"principal": {"x": 0, "y": 0}}}


def _state(text: str = "quiero cambiar mi clave"):
    return {"messages": [HumanMessage(content=text)], "system_prompt": "default", "account_id": "acc"}


async def test_principal_delega_en_subagente_y_usa_su_resultado():
    prompts: list[str] = []
    with patch.object(compiler_mod, "get_model", lambda *a, **k: _ScriptedModel(prompts)):
        graph = compile_graph(_graph(), TOOLS)
        with trace.collect() as events:
            result = await graph.ainvoke(_state())

    reply = message_text(result["messages"][-1])
    assert reply.startswith("Listo. Identidad validada")
    assert "Ana Pérez" in reply

    # El sub-agente corre con su prompt + el contrato, y nunca ve la conversación.
    sub_prompts = [p for p in prompts if "Trabajás para otro agente" in p]
    assert sub_prompts and sub_prompts[0].startswith("Validás identidades.")

    # La conversación del principal no se ensucia con el loop interno del sub-agente.
    names = [m.name for m in result["messages"] if isinstance(m, ToolMessage)]
    assert names == ["delegar_validar_identidad"]

    steps = [(e["agent"], e["kind"], e.get("name")) for e in events]
    assert steps == [
        ("principal", "tool_call", "delegar_validar_identidad"),
        ("validar_identidad", "delegated", None),
        ("validar_identidad", "tool_call", "consultar_registro"),
        ("validar_identidad", "tool_result", "consultar_registro"),
        ("validar_identidad", "message", None),
        ("principal", "tool_result", "delegar_validar_identidad"),
        ("principal", "message", None),
    ]


async def test_fallo_del_subagente_no_tumba_el_turno():
    class _Broken(_ScriptedModel):
        async def ainvoke(self, messages):
            if "Trabajás para otro agente" in str(messages[0].content):
                raise RuntimeError("proveedor caído")
            return await super().ainvoke(messages)

    with patch.object(compiler_mod, "get_model", lambda *a, **k: _Broken([])):
        graph = compile_graph(_graph(), TOOLS)
        result = await graph.ainvoke(_state())

    assert "no pudo completar la tarea" in message_text(result["messages"][-1])


def test_la_descripcion_del_subagente_llega_a_la_herramienta():
    bound: dict = {}

    class _Capture(_ScriptedModel):
        def bind_tools(self, tools):
            bound.update({t.name: t for t in tools})
            return self

    with patch.object(compiler_mod, "get_model", lambda *a, **k: _Capture([])):
        compile_graph(_graph(), TOOLS)

    delegate = bound["delegar_validar_identidad"]
    assert "Valida la identidad del cliente" in delegate.description
    # account_id se inyecta desde el estado: el modelo solo ve `tarea`.
    assert set(delegate.tool_call_schema.model_json_schema()["properties"]) == {"tarea"}


@pytest.mark.parametrize(
    ("graph", "error"),
    [
        ({"version": 2, "agents": []}, "no tiene agentes"),
        (_graph(sub={"role": "main"}), "exactamente un agente principal"),
        (_graph(sub={"subagents": ["principal"]}), "un solo nivel"),
        (_graph(sub={"tools": ["escalar_a_humano"]}), "solo la puede usar el agente principal"),
        (_graph(sub={"description": "  "}), "falta la descripción"),
        (_graph(main={"subagents": ["no_existe"]}), "no existe"),
        (_graph(main={"id": "Principal Uno"}), "id de agente inválido"),
        (_graph(main={"memory_window": 0}), "memory_window"),
        (_graph(main={"tools": "escalar_a_humano"}), "lista de nombres"),
    ],
)
def test_validacion(graph, error):
    with patch.object(compiler_mod, "get_model", lambda *a, **k: _ScriptedModel([])):
        with pytest.raises(GraphCompileError, match=error):
            compile_graph(graph, TOOLS)


def test_trim_history_nunca_empieza_en_un_resultado_de_tool():
    history = [
        HumanMessage(content="hola"),
        AIMessage(content="hola!"),
        HumanMessage(content="mi pedido"),
        _call("consultar_registro", {"documento": "1"}, "c1"),
        ToolMessage(content="ok", name="consultar_registro", tool_call_id="c1"),
        AIMessage(content="listo"),
    ]
    # Cortar en 3 dejaría primero el ToolMessage huérfano.
    trimmed = trim_history(history, 3)
    assert isinstance(trimmed[0], HumanMessage)
    assert trimmed[0].content == "mi pedido"
    assert trim_history(history, None) == history
    assert trim_history(history, 100) == history


def test_tool_called_this_turn_mira_todo_el_turno():
    messages = [
        HumanMessage(content="viejo"),
        _call("escalar_a_humano", {"motivo": "x"}, "a"),
        ToolMessage(content="TRANSFERIR", name="escalar_a_humano", tool_call_id="a"),
        HumanMessage(content="nuevo"),
        _call("escalar_a_humano", {"motivo": "y"}, "b"),
        ToolMessage(content="TRANSFERIR", name="escalar_a_humano", tool_call_id="b"),
        _call("consultar_registro", {"documento": "1"}, "c"),
        ToolMessage(content="ok", name="consultar_registro", tool_call_id="c"),
        AIMessage(content="te paso con un asesor"),
    ]
    # Hay 4 mensajes entre el traspaso y el final: el chequeo viejo (últimos 3) no lo veía.
    assert tool_called_this_turn(messages, "escalar_a_humano")
    assert not tool_called_this_turn(messages[:4], "escalar_a_humano")


def test_message_text_con_bloques():
    msg = AIMessage(content=[{"type": "thinking", "thinking": "…"}, {"type": "text", "text": "Hola"}])
    assert message_text(msg) == "Hola"
    assert message_text(AIMessage(content="plano")) == "plano"
