"""Máquina de estados de la conversación (handoff).

Vive fuera de LangGraph: el worker consulta should_bot_reply() antes de invocar el grafo.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from uuid import UUID

from telar.core.types import ConversationStatus


# Cualquier transición no listada lanza excepción.
_ALLOWED: dict[ConversationStatus, set[ConversationStatus]] = {
    ConversationStatus.BOT: {
        ConversationStatus.PENDING,
        ConversationStatus.OPEN,
        ConversationStatus.RESOLVED,
    },
    ConversationStatus.PENDING: {
        ConversationStatus.OPEN,
        ConversationStatus.BOT,        # nadie la tomó, vuelve al bot
        ConversationStatus.RESOLVED,
    },
    ConversationStatus.OPEN: {
        ConversationStatus.RESOLVED,
        ConversationStatus.PENDING,    # el agente la devolvió a la cola
    },
    ConversationStatus.RESOLVED: {
        ConversationStatus.BOT,        # el cliente volvió a escribir
        ConversationStatus.OPEN,
    },
}


class InvalidTransition(Exception):
    pass


@dataclass
class Conversation:
    id: UUID
    account_id: UUID
    inbox_id: UUID
    contact_id: UUID
    status: ConversationStatus
    assignee_id: UUID | None = None
    team_id: UUID | None = None
    last_contact_message_at: datetime | None = None
    resolved_at: datetime | None = None


def transition(
    conv: Conversation,
    to: ConversationStatus,
    *,
    assignee_id: UUID | None = None,
    team_id: UUID | None = None,
) -> Conversation:
    if to not in _ALLOWED[conv.status]:
        raise InvalidTransition(f"{conv.status.value} -> {to.value} no permitido")

    conv.status = to

    if to is ConversationStatus.OPEN:
        conv.assignee_id = assignee_id or conv.assignee_id
        if conv.assignee_id is None:
            raise InvalidTransition("OPEN requiere un asignado")
    elif to is ConversationStatus.PENDING:
        conv.assignee_id = None
        conv.team_id = team_id or conv.team_id
    elif to is ConversationStatus.BOT:
        conv.assignee_id = None
        conv.resolved_at = None
    elif to is ConversationStatus.RESOLVED:
        conv.resolved_at = datetime.now(timezone.utc)

    return conv


def should_bot_reply(conv: Conversation) -> bool:
    """La única guarda que importa. Se llama antes de invocar el grafo."""
    return conv.status is ConversationStatus.BOT


def on_inbound(conv: Conversation, now: datetime | None = None) -> Conversation:
    """Al recibir un mensaje del cliente: una conversación resuelta se reabre en BOT."""
    now = now or datetime.now(timezone.utc)
    conv.last_contact_message_at = now

    if conv.status is ConversationStatus.RESOLVED:
        transition(conv, ConversationStatus.BOT)

    return conv


def request_handoff(conv: Conversation, team_id: UUID | None = None) -> Conversation:
    """Llamada desde la tool `escalar_a_humano` del agente."""
    return transition(conv, ConversationStatus.PENDING, team_id=team_id)


SERVICE_WINDOW = timedelta(hours=24)


def window_is_open(conv: Conversation, now: datetime | None = None) -> bool:
    """Fuera de la ventana de 24h Meta solo acepta plantillas aprobadas."""
    if conv.last_contact_message_at is None:
        return False
    now = now or datetime.now(timezone.utc)
    return (now - conv.last_contact_message_at) < SERVICE_WINDOW
