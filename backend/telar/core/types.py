"""Contratos núcleo: el grafo y la lógica de negocio solo ven InboundMessage/OutboundMessage,
nunca un payload crudo del canal.
"""

from __future__ import annotations

from datetime import datetime
from enum import Enum
from typing import Any, Literal
from uuid import UUID, uuid4

from pydantic import BaseModel, Field


class Channel(str, Enum):
    WHATSAPP = "whatsapp"
    TELEGRAM = "telegram"
    WEBCHAT = "webchat"


class MessageType(str, Enum):
    TEXT = "text"
    IMAGE = "image"
    AUDIO = "audio"
    VIDEO = "video"
    DOCUMENT = "document"
    LOCATION = "location"
    CONTACTS = "contacts"
    INTERACTIVE = "interactive"
    TEMPLATE = "template"
    UNSUPPORTED = "unsupported"   # sticker, reacción, tipos nuevos de Meta


class SenderType(str, Enum):
    CONTACT = "contact"
    BOT = "bot"
    AGENT = "agent"
    SYSTEM = "system"


class ConversationStatus(str, Enum):
    """BOT: responde la IA. PENDING: en cola del equipo. OPEN: asignada a un humano.
    RESOLVED: el próximo mensaje entrante la reabre en BOT.
    """
    BOT = "bot"
    PENDING = "pending"
    OPEN = "open"
    RESOLVED = "resolved"


class DeliveryStatus(str, Enum):
    PENDING = "pending"
    SENT = "sent"
    DELIVERED = "delivered"
    READ = "read"
    FAILED = "failed"


class MediaRef(BaseModel):
    """En la entrada solo trae external_id: descargar enseguida, la URL de Meta dura minutos."""
    external_id: str | None = None
    mime_type: str | None = None
    filename: str | None = None
    sha256: str | None = None
    size_bytes: int | None = None
    storage_url: str | None = None
    caption: str | None = None


class Location(BaseModel):
    latitude: float
    longitude: float
    name: str | None = None
    address: str | None = None


class ContactRef(BaseModel):
    external_id: str
    name: str | None = None
    phone: str | None = None


class TemplateRef(BaseModel):
    """Plantilla aprobada por Meta; obligatoria fuera de la ventana de 24 horas."""
    name: str
    language: str = "es"
    components: list[dict[str, Any]] = Field(default_factory=list)


class QuickReply(BaseModel):
    id: str
    title: str   # Meta trunca en 20 caracteres


class InboundMessage(BaseModel):
    """Mensaje normalizado. channel_message_id deduplica los reintentos del webhook de Meta."""
    id: UUID = Field(default_factory=uuid4)
    channel_message_id: str

    account_id: UUID
    inbox_id: UUID
    channel: Channel = Channel.WHATSAPP

    contact: ContactRef
    type: MessageType = MessageType.TEXT

    text: str | None = None
    media: MediaRef | None = None
    location: Location | None = None
    interactive_reply_id: str | None = None
    reply_to_channel_message_id: str | None = None

    sent_at: datetime
    received_at: datetime = Field(default_factory=datetime.utcnow)

    raw: dict[str, Any] = Field(default_factory=dict)

    def as_agent_text(self) -> str:
        """Lo que efectivamente ve el LLM como turno del usuario."""
        if self.type is MessageType.TEXT and self.text:
            return self.text
        if self.type is MessageType.INTERACTIVE:
            return self.text or f"[selección: {self.interactive_reply_id}]"
        if self.type is MessageType.LOCATION and self.location:
            return f"[ubicación: {self.location.latitude},{self.location.longitude}]"
        if self.media and self.media.caption:
            return self.media.caption
        return f"[{self.type.value} recibido]"


class OutboundMessage(BaseModel):
    """Lo que el agente o un humano quiere enviar; el adaptador lo traduce a la API del canal."""
    id: UUID = Field(default_factory=uuid4)
    conversation_id: UUID
    sender_type: SenderType = SenderType.BOT
    sender_id: UUID | None = None   # user_id si es agente, bot_id si es IA

    type: MessageType = MessageType.TEXT
    text: str | None = None
    media: MediaRef | None = None
    template: TemplateRef | None = None
    quick_replies: list[QuickReply] = Field(default_factory=list)

    reply_to_channel_message_id: str | None = None
    idempotency_key: str | None = None

    def requires_template(self) -> bool:
        """True si este mensaje solo puede salir como plantilla aprobada."""
        return self.type is MessageType.TEMPLATE


class SendResult(BaseModel):
    ok: bool
    channel_message_id: str | None = None
    status: DeliveryStatus = DeliveryStatus.PENDING
    error_code: str | None = None
    error_message: str | None = None
    retryable: bool = False


class ChannelAdapter:
    """Puerto que implementan los adaptadores de canal."""

    channel: Channel

    def verify_webhook(self, params: dict[str, str]) -> str | None:
        """Handshake GET de verificación. Devuelve hub.challenge o None."""
        raise NotImplementedError

    def verify_signature(self, raw_body: bytes, signature_header: str | None) -> bool:
        raise NotImplementedError

    def parse(self, payload: dict[str, Any]) -> list[InboundMessage]:
        raise NotImplementedError

    async def send(self, message: OutboundMessage, to: ContactRef) -> SendResult:
        raise NotImplementedError

    async def download_media(self, media: MediaRef, *, access_token: str | None = None) -> MediaRef:
        raise NotImplementedError

    async def mark_read(self, channel_message_id: str) -> None:
        raise NotImplementedError


WindowStatus = Literal["open", "closed"]
