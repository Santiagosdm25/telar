"""Formato v2 del grafo: un agente principal (el único que habla con el cliente) y
sub-agentes expuestos como herramientas `delegar_<id>`. Un solo nivel de delegación.

    {
      "version": 2,
      "agents": [
        {"id": "principal", "role": "main", "name": "Agente principal",
         "system_prompt": "...", "tools": ["escalar_a_humano"],
         "subagents": ["validar_identidad"], "memory_window": 30},
        {"id": "validar_identidad", "role": "sub", "name": "Validar identidad",
         "description": "Cuándo llamarlo: el cliente quiere cambiar datos sensibles…",
         "system_prompt": "...", "tools": ["api_registraduria", "enviar_otp"]}
      ],
      "layout": {"principal": {"x": 0, "y": 0}, "tool:enviar_otp": {"x": 0, "y": 0}}
    }

`layout` es solo para el lienzo; el runtime lo ignora.
"""

from __future__ import annotations

import logging
import re
from typing import Annotated, Any

from langchain_core.messages import HumanMessage
from langchain_core.tools import BaseTool, StructuredTool
from langgraph.graph import END, START, StateGraph
from langgraph.prebuilt import InjectedState

from telar.agent import trace
from telar.agent.compiler import (
    AgentState,
    GraphCompileError,
    make_agent_node,
    make_tools_node,
    message_text,
)

log = logging.getLogger(__name__)

# Los proveedores exigen ^[a-zA-Z0-9_-]{1,64}$ en nombres de tools (`delegar_<id>`).
_ID_RE = re.compile(r"^[a-z0-9_]{1,40}$")

# Un traspaso pedido desde un sub-agente quedaría escondido en su loop.
MAIN_ONLY_TOOLS = {"escalar_a_humano"}

# Tope de pasos del loop de un sub-agente.
_SUBAGENT_RECURSION_LIMIT = 16

_SUBAGENT_CONTRACT = """

---
Trabajás para otro agente, no hablás con el cliente. Recibís una tarea con
los datos que ya se juntaron. Usá tus herramientas para resolverla y
respondé con el resultado concreto, breve y sin saludos.
Si te falta un dato del cliente para seguir, respondé empezando con
"FALTA:" y qué dato necesitás. No inventes datos."""


def delegate_tool_name(agent_id: str) -> str:
    return f"delegar_{agent_id}"


def compile_multi_agent(
    graph_json: dict[str, Any],
    available_tools: list[BaseTool],
    model_spec: str | None,
    model_kwargs: dict[str, Any] | None,
    checkpointer: Any,
):
    agents = _validate(graph_json)
    tools_by_name = {t.name: t for t in available_tools}
    main = next(a for a in agents.values() if a["role"] == "main")

    delegate_tools = [
        _make_delegate_tool(
            agents[sub_id], tools_by_name, model_spec, model_kwargs
        )
        for sub_id in main.get("subagents") or []
    ]
    main_tools = _resolve(main, tools_by_name) + delegate_tools

    graph = StateGraph(AgentState)
    _add_agent_loop(graph, main, main_tools, model_spec, model_kwargs)
    graph.add_edge(START, main["id"])
    return graph.compile(checkpointer=checkpointer)


def _validate(graph_json: dict[str, Any]) -> dict[str, dict[str, Any]]:
    raw = graph_json.get("agents")
    if not isinstance(raw, list) or not raw:
        raise GraphCompileError("el grafo no tiene agentes")

    agents: dict[str, dict[str, Any]] = {}
    for agent in raw:
        if not isinstance(agent, dict):
            raise GraphCompileError("cada agente tiene que ser un objeto")
        agent_id = agent.get("id")
        if not isinstance(agent_id, str) or not _ID_RE.match(agent_id):
            raise GraphCompileError(
                f"id de agente inválido: {agent_id!r} (solo minúsculas, números y _)"
            )
        if agent_id in agents:
            raise GraphCompileError(f"hay dos agentes con el id {agent_id!r}")
        if agent.get("role") not in ("main", "sub"):
            raise GraphCompileError(f"{agent_id}: role tiene que ser 'main' o 'sub'")
        for field in ("tools", "subagents"):
            value = agent.get(field)
            if value is not None and not (
                isinstance(value, list) and all(isinstance(v, str) for v in value)
            ):
                raise GraphCompileError(f"{agent_id}: {field} tiene que ser una lista de nombres")
        window = agent.get("memory_window")
        if window is not None and (not isinstance(window, int) or window < 1):
            raise GraphCompileError(f"{agent_id}: memory_window tiene que ser un entero ≥ 1")
        agents[agent_id] = agent

    mains = [a for a in agents.values() if a["role"] == "main"]
    if len(mains) != 1:
        raise GraphCompileError("tiene que haber exactamente un agente principal")

    for agent in agents.values():
        subagents = agent.get("subagents") or []
        if agent["role"] == "sub" and subagents:
            raise GraphCompileError(
                f"{agent['id']}: un sub-agente no puede tener sub-agentes (un solo nivel)"
            )
        for sub_id in subagents:
            target = agents.get(sub_id)
            if target is None:
                raise GraphCompileError(f"{agent['id']} delega en {sub_id!r}, que no existe")
            if target["role"] != "sub":
                raise GraphCompileError(f"{agent['id']} delega en {sub_id!r}, que no es sub-agente")
        if agent["role"] == "sub":
            if not (agent.get("description") or "").strip():
                raise GraphCompileError(
                    f"{agent['id']}: falta la descripción (el principal la usa para saber "
                    "cuándo llamarlo)"
                )
            forbidden = MAIN_ONLY_TOOLS & set(agent.get("tools") or [])
            if forbidden:
                raise GraphCompileError(
                    f"{agent['id']}: {', '.join(sorted(forbidden))} solo la puede usar el "
                    "agente principal"
                )
    return agents


def _resolve(agent: dict[str, Any], tools_by_name: dict[str, BaseTool]) -> list[BaseTool]:
    """En v2 la lista es explícita: sin `tools`, el agente no tiene ninguna."""
    resolved = []
    for name in agent.get("tools") or []:
        tool = tools_by_name.get(name)
        if tool is None:
            # Una tool borrada en Configuración no rompe el bot entero.
            log.warning("agente %s: tool desconocida %r, se ignora", agent["id"], name)
            continue
        resolved.append(tool)
    return resolved


def _add_agent_loop(
    graph: StateGraph,
    agent: dict[str, Any],
    tools: list[BaseTool],
    model_spec: str | None,
    model_kwargs: dict[str, Any] | None,
    system_prompt: str | None = None,
) -> None:
    """Nodo del agente + nodo de herramientas en loop, hasta que responde sin tool_calls."""
    agent_id = agent["id"]
    graph.add_node(
        agent_id,
        make_agent_node(
            system_prompt if system_prompt is not None else agent.get("system_prompt"),
            tools,
            model_spec,
            model_kwargs,
            memory_window=agent.get("memory_window"),
            agent_id=agent_id,
        ),
    )
    if not tools:
        graph.add_edge(agent_id, END)
        return

    tools_id = f"{agent_id}__tools"
    graph.add_node(tools_id, make_tools_node(tools, agent_id=agent_id))

    def route(state: AgentState):
        last = state["messages"][-1]
        return tools_id if getattr(last, "tool_calls", None) else END

    graph.add_conditional_edges(agent_id, route, {tools_id: tools_id, END: END})
    graph.add_edge(tools_id, agent_id)


def _make_delegate_tool(
    sub: dict[str, Any],
    tools_by_name: dict[str, BaseTool],
    model_spec: str | None,
    model_kwargs: dict[str, Any] | None,
) -> BaseTool:
    sub_id = sub["id"]
    name = sub.get("name") or sub_id

    sub_graph = StateGraph(AgentState)
    _add_agent_loop(
        sub_graph,
        sub,
        _resolve(sub, tools_by_name),
        model_spec,
        model_kwargs,
        system_prompt=(sub.get("system_prompt") or f"Sos {name}.") + _SUBAGENT_CONTRACT,
    )
    sub_graph.add_edge(START, sub_id)
    # Sin checkpointer: la memoria de la conversación es solo del principal.
    compiled = sub_graph.compile()

    async def delegate(
        tarea: str,
        account_id: Annotated[str, InjectedState("account_id")],
    ) -> str:
        trace.record(agent=sub_id, kind="delegated", text=trace.clip(tarea))
        try:
            result = await compiled.ainvoke(
                {
                    "messages": [HumanMessage(content=tarea)],
                    "system_prompt": "",
                    "account_id": account_id,
                },
                config={"recursion_limit": _SUBAGENT_RECURSION_LIMIT},
            )
        except Exception as e:
            # Un fallo del sub-agente no tumba el turno del principal.
            log.exception("el sub-agente %s falló", sub_id)
            trace.record(agent=sub_id, kind="error", text=trace.clip(e))
            return f"{name} no pudo completar la tarea por un error interno."
        return message_text(result["messages"][-1]).strip() or f"{name} no devolvió respuesta."

    return StructuredTool.from_function(
        coroutine=delegate,
        name=delegate_tool_name(sub_id),
        description=(
            f"Delega una tarea en {name}, un especialista. Usala solo cuando la "
            f"conversación lo necesite; si podés responder vos, no la llames. "
            f"Cuándo sirve: {sub['description'].strip()}\n\n"
            "En `tarea` explicá qué necesitás e incluí todos los datos del cliente "
            "que ya tengas: no ve la conversación. Si responde con FALTA:, pedíselo "
            "al cliente y volvé a llamarlo con el dato."
        ),
    )
