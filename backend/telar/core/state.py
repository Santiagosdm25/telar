"""
Máquina de estados de la conversación.

Esto es el handoff completo, y vive fuera de LangGraph a propósito: el worker
consulta should_bot_reply() ANTES de invocar el grafo. Si un agente humano
tiene la conversación, el mensaje se persiste y se notifica, pero la IA no
genera nada. Sin esta guarda la IA responde encima del asesor.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from uuid import UUID

from telar.core.types import ConversationStatus


# Transiciones permitidas. Cualquier otra lanza excepción: es preferible un
# error ruidoso en desarrollo que una conversación en un estado imposible.
_ALLOWED: dict[ConversationStatus, set[ConversationStatus]] = {
    ConversationStatus.BOT: {
        ConversationStatus.PENDING,    # el bot pidió humano
        ConversationStatus.OPEN,       # un agente la tomó directamente
        ConversationStatus.RESOLVED,   # el bot cerró el caso
    },
    ConversationStatus.PENDING: {
        ConversationStatus.OPEN,       # un agente la tomó
        ConversationStatus.BOT,        # nadie la tomó, vuelve al bot
        ConversationStatus.RESOLVED,
    },
    ConversationStatus.OPEN: {
        ConversationStatus.RESOLVED,   # el agente cerró
        ConversationStatus.PENDING,    # el agente la devolvió a la cola
    },
    ConversationStatus.RESOLVED: {
        ConversationStatus.BOT,        # el cliente volvió a escribir
        ConversationStatus.OPEN,       # un agente la reabrió
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
    """
    Se ejecuta al recibir cualquier mensaje del cliente, antes de decidir si
    el bot contesta. Una conversación cerrada que recibe mensaje se reabre
    en manos del bot, que es exactamente el comportamiento pedido.
    """
    now = now or datetime.now(timezone.utc)
    conv.last_contact_message_at = now

    if conv.status is ConversationStatus.RESOLVED:
        transition(conv, ConversationStatus.BOT)

    return conv


def request_handoff(conv: Conversation, team_id: UUID | None = None) -> Conversation:
    """Llamada desde la tool `escalar_a_humano` del agente."""
    return transition(conv, ConversationStatus.PENDING, team_id=team_id)


# --------------------------------------------------------------------------
# Ventana de servicio de 24 horas
# --------------------------------------------------------------------------

SERVICE_WINDOW = timedelta(hours=24)


def window_is_open(conv: Conversation, now: datetime | None = None) -> bool:
    """
    Fuera de la ventana, Meta solo acepta plantillas aprobadas. Si no revisas
    esto antes de enviar, la API devuelve error y el bot se queda mudo sin
    señal visible en la bandeja.
    """
    if conv.last_contact_message_at is None:
        return False
    now = now or datetime.now(timezone.utc)
    return (now - conv.last_contact_message_at) < SERVICE_WINDOW
