"""Endpoints del bot de la cuenta (uno por cuenta)."""

from __future__ import annotations

from datetime import datetime
from typing import Any
from uuid import UUID, uuid4

from fastapi import APIRouter, Depends, HTTPException, status
from langchain_core.messages import HumanMessage
from pydantic import BaseModel

from telar.agent import graph_cache, trace
from telar.agent.checkpointer import get_checkpointer
from telar.agent.compiler import (
    GraphCompileError,
    compile_graph,
    message_text,
    tool_called_this_turn,
)
from telar.agent.graph import TOOLS
from telar.agent.tools import escalar_a_humano
from telar.auth.dependencies import Membership, require_role
from telar.auth.roles import AccountRole
from telar.config import settings
from telar.custom_tools.loader import build_custom_tools
from telar.db import repositories as repo

router = APIRouter(prefix="/accounts/{account_id}/bot", tags=["bot"])


class BotResponse(BaseModel):
    id: UUID
    name: str
    version: int
    graph: dict[str, Any]


class SaveBotRequest(BaseModel):
    name: str = "Bot principal"
    graph: dict[str, Any]
    notes: str | None = None


class BotVersionResponse(BaseModel):
    id: UUID
    version: int
    notes: str | None
    created_by: UUID | None
    created_at: datetime
    is_active: bool


class AvailableToolResponse(BaseModel):
    name: str
    description: str
    # "system" (las fijas de Telar) o el tipo de la tool configurable: http, sql, document.
    kind: str


async def _get_bot_or_404(account_id: UUID) -> dict:
    bot = await repo.get_bot_for_account(account_id)
    if bot is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "La cuenta todavía no tiene un bot")
    return bot


@router.get("", response_model=BotResponse | None)
async def get_bot(
    account_id: UUID, membership: Membership = Depends(require_role())
) -> BotResponse | None:
    bot = await repo.get_bot_for_account(account_id)
    if bot is None or bot["active_version_id"] is None:
        return None

    version = await repo.get_bot_version(bot["active_version_id"])
    if version is None:
        return None

    return BotResponse(
        id=bot["id"], name=bot["name"], version=version["version"], graph=version["graph"]
    )


@router.put("", response_model=BotResponse)
async def save_bot(
    account_id: UUID,
    body: SaveBotRequest,
    membership: Membership = Depends(require_role(AccountRole.ADMINISTRATOR)),
) -> BotResponse:
    # Se compila con las tools reales de la cuenta antes de guardar.
    extra_tools = await build_custom_tools(account_id)
    try:
        compile_graph(body.graph, available_tools=TOOLS + extra_tools)
    except GraphCompileError as e:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, str(e)) from e

    bot = await repo.get_bot_for_account(account_id)
    bot_id = bot["id"] if bot else await repo.insert_bot(account_id, body.name)

    version = await repo.get_next_bot_version(bot_id)
    version_id = await repo.insert_bot_version(
        bot_id, version, body.graph, notes=body.notes, created_by=membership.user_id
    )
    await repo.set_active_bot_version(bot_id, version_id)
    await graph_cache.invalidate(account_id)

    return BotResponse(id=bot_id, name=body.name, version=version, graph=body.graph)


@router.get("/versions", response_model=list[BotVersionResponse])
async def list_bot_versions(
    account_id: UUID, membership: Membership = Depends(require_role())
) -> list[BotVersionResponse]:
    bot = await _get_bot_or_404(account_id)
    rows = await repo.list_bot_versions(bot["id"])
    return [BotVersionResponse(**row) for row in rows]


@router.post("/versions/{version_id}/activate", response_model=BotVersionResponse)
async def activate_bot_version(
    account_id: UUID,
    version_id: UUID,
    membership: Membership = Depends(require_role(AccountRole.ADMINISTRATOR)),
) -> BotVersionResponse:
    """Activa una versión ya guardada, sin recompilar."""
    bot = await _get_bot_or_404(account_id)
    version = await repo.get_bot_version(version_id)
    if version is None or version["bot_id"] != bot["id"]:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Versión no encontrada")

    await repo.set_active_bot_version(bot["id"], version_id)
    await graph_cache.invalidate(account_id)

    versions = await repo.list_bot_versions(bot["id"])
    activated = next(v for v in versions if v["id"] == version_id)
    return BotVersionResponse(**activated)


@router.get("/available-tools", response_model=list[AvailableToolResponse])
async def list_available_tools(
    account_id: UUID, membership: Membership = Depends(require_role())
) -> list[AvailableToolResponse]:
    extra_tools = await build_custom_tools(account_id)
    return [
        AvailableToolResponse(
            name=t.name, description=t.description, kind=(t.metadata or {}).get("kind", "system")
        )
        for t in TOOLS + extra_tools
    ]


class TestChatRequest(BaseModel):
    message: str
    session_id: str | None = None  # None = sesión de prueba nueva


class TraceEvent(BaseModel):
    """Un paso del turno, para mostrar en el lienzo qué agente hizo qué."""

    agent: str
    # delegated | tool_call | tool_result | message | error
    kind: str
    name: str | None = None
    args: dict[str, Any] | None = None
    text: str | None = None
    error: bool = False


class TestChatResponse(BaseModel):
    session_id: str
    reply: str
    would_escalate: bool
    trace: list[TraceEvent] = []


@router.post("/test-chat", response_model=TestChatResponse)
async def test_chat(
    account_id: UUID,
    body: TestChatRequest,
    membership: Membership = Depends(require_role(AccountRole.ADMINISTRATOR)),
) -> TestChatResponse:
    """Prueba el bot con el grafo de producción sin tocar contactos ni conversaciones reales.

    El thread_id usa el prefijo "test:", que ningún contact_id puede generar. escalar_a_humano
    no hace traspaso: solo se reporta en would_escalate.
    """
    session_id = body.session_id or str(uuid4())
    thread_id = f"test:{account_id}:{session_id}"

    checkpointer = await get_checkpointer()
    graph = await graph_cache.get_or_build(account_id, checkpointer)

    with trace.collect() as events:
        result = await graph.ainvoke(
            {
                "messages": [HumanMessage(content=body.message)],
                "system_prompt": settings().default_system_prompt,
                "account_id": str(account_id),
            },
            config={"configurable": {"thread_id": thread_id}},
        )

    return TestChatResponse(
        session_id=session_id,
        reply=message_text(result["messages"][-1]),
        would_escalate=tool_called_this_turn(result["messages"], escalar_a_humano.name),
        trace=[TraceEvent(**e) for e in events],
    )
