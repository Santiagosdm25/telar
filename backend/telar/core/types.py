"""
Contratos núcleo del proyecto.

Regla que no se rompe: ni el grafo del agente ni la lógica de negocio ven
nunca un payload crudo de Meta o de Chatwoot. Todo entra como InboundMessage
y sale como OutboundMessage. Cambiar de canal = escribir un adaptador nuevo.
"""

from __future__ import annotations

from datetime import datetime
from enum import Enum
from typing import Any, Literal
from uuid import UUID, uuid4

from pydantic import BaseModel, Field


# --------------------------------------------------------------------------
# Enumeraciones
# --------------------------------------------------------------------------

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
    INTERACTIVE = "interactive"   # respuesta a botón o lista
    TEMPLATE = "template"         # solo salida, fuera de ventana de 24h
    UNSUPPORTED = "unsupported"   # sticker, reacción, lo que Meta agregue mañana


class SenderType(str, Enum):
    CONTACT = "contact"
    BOT = "bot"
    AGENT = "agent"
    SYSTEM = "system"


class ConversationStatus(str, Enum):
    """
    Máquina de estados de la conversación. Ver state.py para las transiciones.

    BOT      -> la IA responde
    PENDING  -> se pidió humano, está en cola del equipo, la IA ya no responde
    OPEN     -> asignada a un agente humano, la IA solo persiste mensajes
    RESOLVED -> cerrada; el próximo mensaje entrante la reabre en BOT
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


# --------------------------------------------------------------------------
# Piezas compartidas
# --------------------------------------------------------------------------

class MediaRef(BaseModel):
    """
    Referencia a un archivo. En la entrada llega solo external_id: hay que
    descargarlo con el token del canal antes de que expire (Meta lo borra
    a los 30 días, y la URL firmada dura minutos).
    """
    external_id: str | None = None
    mime_type: str | None = None
    filename: str | None = None
    sha256: str | None = None
    size_bytes: int | None = None
    storage_url: str | None = None   # se llena tras descargar
    caption: str | None = None


class Location(BaseModel):
    latitude: float
    longitude: float
    name: str | None = None
    address: str | None = None


class ContactRef(BaseModel):
    """Identidad del cliente tal como la reporta el canal."""
    external_id: str            # wa_id en WhatsApp
    name: str | None = None
    phone: str | None = None


class TemplateRef(BaseModel):
    """
    Plantilla aprobada por Meta. Obligatoria para iniciar conversación o para
    responder fuera de la ventana de 24 horas.
    """
    name: str
    language: str = "es"
    components: list[dict[str, Any]] = Field(default_factory=list)


class QuickReply(BaseModel):
    id: str
    title: str   # Meta trunca en 20 caracteres


# --------------------------------------------------------------------------
# Mensaje entrante
# --------------------------------------------------------------------------

class InboundMessage(BaseModel):
    """
    Un mensaje ya normalizado, listo para el worker.

    channel_message_id es la llave de deduplicación: Meta reintenta el webhook
    y sin el índice único sobre (inbox_id, channel_message_id) el bot responde
    dos veces al mismo mensaje.
    """
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
    interactive_reply_id: str | None = None   # id del botón que tocó
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


# --------------------------------------------------------------------------
# Mensaje saliente
# --------------------------------------------------------------------------

class OutboundMessage(BaseModel):
    """
    Lo que el agente o un humano quiere enviar. El adaptador del canal lo
    traduce al formato de la API concreta; a este nivel no existe Meta.
    """
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


# --------------------------------------------------------------------------
# Resultado del envío
# --------------------------------------------------------------------------

class SendResult(BaseModel):
    ok: bool
    channel_message_id: str | None = None
    status: DeliveryStatus = DeliveryStatus.PENDING
    error_code: str | None = None
    error_message: str | None = None
    retryable: bool = False


# --------------------------------------------------------------------------
# Puerto del canal
# --------------------------------------------------------------------------

class ChannelAdapter:
    """
    Interfaz que implementan meta_direct y chatwoot. Nada más del sistema
    conoce las APIs externas.
    """

    channel: Channel

    def verify_webhook(self, params: dict[str, str]) -> str | None:
        """Handshake GET de verificación. Devuelve hub.challenge o None."""
        raise NotImplementedError

    def verify_signature(self, raw_body: bytes, signature_header: str | None) -> bool:
        raise NotImplementedError

    def parse(self, payload: dict[str, Any]) -> list[InboundMessage]:
        """Un webhook puede traer varios mensajes y también solo estados."""
        raise NotImplementedError

    async def send(self, message: OutboundMessage, to: ContactRef) -> SendResult:
        raise NotImplementedError

    async def download_media(self, media: MediaRef, *, access_token: str | None = None) -> MediaRef:
        raise NotImplementedError

    async def mark_read(self, channel_message_id: str) -> None:
        raise NotImplementedError


WindowStatus = Literal["open", "closed"]
