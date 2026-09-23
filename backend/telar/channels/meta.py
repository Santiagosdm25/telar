"""
Adaptador de WhatsApp Cloud API.

Es el único archivo del proyecto que conoce el formato de Meta. Todo lo que
sale de aquí es InboundMessage; todo lo que entra es OutboundMessage.
"""

from __future__ import annotations

import hashlib
import hmac
import logging
from datetime import UTC, datetime
from typing import Any
from uuid import UUID

import httpx

from telar.config import settings
from telar.core import crypto
from telar.core.types import (
    Channel,
    ChannelAdapter,
    ContactRef,
    InboundMessage,
    Location,
    MediaRef,
    MessageType,
    OutboundMessage,
    SendResult,
)
from telar.db import repositories as repo
from telar.media import storage as media_storage

log = logging.getLogger(__name__)

_MEDIA_TYPES = {"image", "audio", "video", "document", "sticker"}


_VALID_STATUSES = {"sent", "delivered", "read", "failed"}


class MetaWhatsAppAdapter(ChannelAdapter):
    channel = Channel.WHATSAPP

    def __init__(
        self,
        access_token: str,
        phone_number_id: str,
        app_secret: str,
        verify_token: str,
        api_version: str = "v21.0",
    ) -> None:
        self.access_token = access_token
        self.phone_number_id = phone_number_id
        self.app_secret = app_secret
        self.verify_token = verify_token
        self.base = f"https://graph.facebook.com/{api_version}"

    # ---------------------------------------------------------------- entrada

    def verify_webhook(self, params: dict[str, str]) -> str | None:
        if (
            params.get("hub.mode") == "subscribe"
            and params.get("hub.verify_token") == self.verify_token
        ):
            return params.get("hub.challenge")
        return None

    def verify_signature(self, raw_body: bytes, signature_header: str | None) -> bool:
        """
        Sin esta validación tu endpoint es público y cualquiera puede hacer
        hablar a tu bot. No la desactives ni en desarrollo.
        """
        # Sin secreto, el HMAC se calcularía con clave vacía y cualquiera
        # podría firmar: se rechaza todo en vez de aceptar todo.
        if not self.app_secret:
            return False
        if not signature_header or not signature_header.startswith("sha256="):
            return False
        expected = hmac.new(
            self.app_secret.encode(), raw_body, hashlib.sha256
        ).hexdigest()
        return hmac.compare_digest(expected, signature_header[7:])

    def parse(
        self, payload: dict[str, Any], *, account_id: UUID, inbox_id: UUID
    ) -> list[InboundMessage]:
        out: list[InboundMessage] = []

        for entry in payload.get("entry", []):
            for change in entry.get("changes", []):
                value = change.get("value", {})

                # Los webhooks de estado (sent/delivered/read) no son mensajes.
                if "messages" not in value:
                    continue

                profiles = {
                    c.get("wa_id"): c.get("profile", {}).get("name")
                    for c in value.get("contacts", [])
                }

                for raw in value["messages"]:
                    try:
                        msg = self._parse_one(raw, profiles, account_id, inbox_id)
                    except Exception:
                        # Un campo faltante/con formato nuevo en un solo
                        # mensaje no debe tumbar el lote entero -- Meta
                        # agrupa varios mensajes por webhook.
                        log.exception(
                            "no se pudo parsear un mensaje del lote (id=%s), se omite",
                            raw.get("id"),
                        )
                        continue
                    if msg:
                        out.append(msg)
        return out

    def parse_statuses(self, payload: dict[str, Any]) -> list[dict[str, str]]:
        """
        Actualizaciones de estado de mensajes salientes -- mismo formato de
        webhook que parse(), pero en value.statuses en vez de
        value.messages. No son InboundMessage: son un UPDATE puntual sobre
        un mensaje que ya mandamos (ver repositories.update_message_delivery_status).
        """
        out: list[dict[str, str]] = []
        for entry in payload.get("entry", []):
            for change in entry.get("changes", []):
                for raw in change.get("value", {}).get("statuses", []):
                    channel_message_id = raw.get("id")
                    status = raw.get("status")
                    if channel_message_id and status in _VALID_STATUSES:
                        out.append({"channel_message_id": channel_message_id, "status": status})
        return out

    def _parse_one(
        self,
        raw: dict[str, Any],
        profiles: dict[str, str],
        account_id: UUID,
        inbox_id: UUID,
    ) -> InboundMessage | None:
        wa_id = raw.get("from")
        if not wa_id:
            return None

        kind = raw.get("type", "unsupported")
        contact = ContactRef(
            external_id=wa_id, name=profiles.get(wa_id), phone=f"+{wa_id}"
        )

        common = {
            "channel_message_id": raw["id"],
            "account_id": account_id,
            "inbox_id": inbox_id,
            "contact": contact,
            "sent_at": datetime.fromtimestamp(int(raw["timestamp"]), tz=UTC),
            "reply_to_channel_message_id": raw.get("context", {}).get("id"),
            "raw": raw,
        }

        if kind == "text":
            return InboundMessage(
                **common, type=MessageType.TEXT, text=raw["text"]["body"]
            )

        if kind == "interactive":
            interactive = raw["interactive"]
            reply = interactive.get("button_reply") or interactive.get("list_reply") or {}
            return InboundMessage(
                **common,
                type=MessageType.INTERACTIVE,
                text=reply.get("title"),
                interactive_reply_id=reply.get("id"),
            )

        if kind == "button":
            return InboundMessage(
                **common,
                type=MessageType.INTERACTIVE,
                text=raw["button"].get("text"),
                interactive_reply_id=raw["button"].get("payload"),
            )

        if kind == "location":
            loc = raw["location"]
            return InboundMessage(
                **common,
                type=MessageType.LOCATION,
                location=Location(
                    latitude=loc["latitude"],
                    longitude=loc["longitude"],
                    name=loc.get("name"),
                    address=loc.get("address"),
                ),
            )

        if kind in _MEDIA_TYPES:
            node = raw[kind]
            return InboundMessage(
                **common,
                type=MessageType(kind) if kind != "sticker" else MessageType.IMAGE,
                media=MediaRef(
                    external_id=node.get("id"),
                    mime_type=node.get("mime_type"),
                    sha256=node.get("sha256"),
                    filename=node.get("filename"),
                    caption=node.get("caption"),
                ),
            )

        log.info("tipo de mensaje no soportado: %s", kind)
        return InboundMessage(**common, type=MessageType.UNSUPPORTED)

    # ---------------------------------------------------------------- salida

    async def send(
        self,
        message: OutboundMessage,
        to: ContactRef,
        *,
        phone_number_id: str | None = None,
        access_token: str | None = None,
    ) -> SendResult:
        """
        `phone_number_id`/`access_token` permiten enviar desde un inbox
        específico de la cuenta en vez del número global de .env -- ver
        resolve_inbox_credentials(). Si no se pasan, usa los del adapter
        (instalación de un solo número, comportamiento de siempre).
        """
        phone_number_id = phone_number_id or self.phone_number_id
        access_token = access_token or self.access_token
        body = self._build_body(message, to)
        url = f"{self.base}/{phone_number_id}/messages"

        # SendResult modela el "no se pudo enviar" (ok=False, error_code,
        # retryable) justamente para no dejar que un fallo de transporte
        # (red, TLS, token vacío -> header inválido) escape como excepción
        # sin atrapar hacia quien llama.
        try:
            async with httpx.AsyncClient(timeout=20) as client:
                resp = await client.post(
                    url,
                    json=body,
                    headers={"Authorization": f"Bearer {access_token}"},
                )
        except httpx.HTTPError as e:
            log.warning("envío falló: error de transporte %s", e)
            return SendResult(ok=False, error_code="transport_error", error_message=str(e), retryable=True)

        if resp.status_code >= 400:
            err = resp.json().get("error", {})
            code = str(err.get("code", resp.status_code))
            log.warning("envío falló %s: %s", code, err.get("message"))
            return SendResult(
                ok=False,
                error_code=code,
                error_message=err.get("message"),
                # 131047 y 131026 no se reintentan: son reglas de negocio.
                retryable=resp.status_code >= 500 or resp.status_code == 429,
            )

        data = resp.json()
        return SendResult(
            ok=True, channel_message_id=data["messages"][0]["id"], status="sent"
        )

    def _build_body(self, message: OutboundMessage, to: ContactRef) -> dict[str, Any]:
        body: dict[str, Any] = {
            "messaging_product": "whatsapp",
            "recipient_type": "individual",
            "to": to.external_id,
        }

        if message.template:
            body["type"] = "template"
            body["template"] = {
                "name": message.template.name,
                "language": {"code": message.template.language},
                "components": message.template.components,
            }
            return body

        if message.quick_replies:
            body["type"] = "interactive"
            body["interactive"] = {
                "type": "button",
                "body": {"text": message.text or ""},
                "action": {
                    "buttons": [
                        {"type": "reply", "reply": {"id": q.id, "title": q.title[:20]}}
                        for q in message.quick_replies[:3]
                    ]
                },
            }
            return body

        body["type"] = "text"
        body["text"] = {"body": message.text or "", "preview_url": False}
        if message.reply_to_channel_message_id:
            body["context"] = {"message_id": message.reply_to_channel_message_id}
        return body

    async def mark_read(
        self,
        channel_message_id: str,
        *,
        phone_number_id: str | None = None,
        access_token: str | None = None,
    ) -> None:
        phone_number_id = phone_number_id or self.phone_number_id
        access_token = access_token or self.access_token
        # Marcar como leído es un efecto secundario, no el turno del agente
        # -- un token vacío/vencido acá no debe tumbar worker/dispatcher.py
        # (mismo motivo que ya tiene el try/except de send(), más abajo).
        try:
            async with httpx.AsyncClient(timeout=10) as client:
                await client.post(
                    f"{self.base}/{phone_number_id}/messages",
                    json={
                        "messaging_product": "whatsapp",
                        "status": "read",
                        "message_id": channel_message_id,
                    },
                    headers={"Authorization": f"Bearer {access_token}"},
                )
        except httpx.HTTPError as e:
            log.warning("no se pudo marcar como leído %s: %s", channel_message_id, e)

    async def download_media(self, media: MediaRef, *, access_token: str | None = None) -> MediaRef:
        """
        La URL que devuelve Meta expira en minutos. Descarga apenas llegue
        el mensaje, no cuando el agente lo necesite.

        Si algo falla acá (Meta caída, media ya vencida, archivo gigante),
        se propaga: quien llama decide si vale la pena perder el mensaje
        completo por eso o solo quedarse sin el archivo (ver pipeline.py).
        """
        if not media.external_id:
            return media

        token = access_token or self.access_token
        headers = {"Authorization": f"Bearer {token}"}
        async with httpx.AsyncClient(timeout=30) as client:
            meta = await client.get(f"{self.base}/{media.external_id}", headers=headers)
            meta.raise_for_status()
            info = meta.json()

            size = int(info.get("file_size", 0))
            if size and size > settings().media_max_bytes:
                log.warning("media %s excede el tamaño máximo (%s bytes), no se descarga",
                            media.external_id, size)
                return media

            binary = await client.get(info["url"], headers=headers)
            binary.raise_for_status()

        media.mime_type = info.get("mime_type", media.mime_type)
        media.size_bytes = len(binary.content)
        await media_storage.save(media.external_id, binary.content)
        # No es una URL servible tal cual (el endpoint real está scopeado
        # por cuenta/conversación, ver conversations/router.py
        # get_message_media) -- este campo es solo la señal de "ya está
        # guardado" que el frontend chequea antes de intentar traerlo.
        media.storage_url = f"stored:{media.external_id}"
        return media


def default_adapter() -> MetaWhatsAppAdapter:
    s = settings()
    return MetaWhatsAppAdapter(
        access_token=s.meta_access_token,
        phone_number_id=s.meta_phone_number_id,
        app_secret=s.meta_app_secret,
        verify_token=s.meta_verify_token,
        api_version=s.meta_api_version,
    )


async def resolve_inbox_credentials(inbox_id: UUID) -> tuple[str, str]:
    """
    (phone_number_id, access_token) a usar para enviar por este inbox.

    Si el inbox no tiene credenciales propias todavía -- el caso de una
    instalación de un solo número que sigue operando 100% desde .env, o de
    un inbox creado antes de que existiera este CRUD -- cae a las
    variables de entorno globales. Así ninguna instalación existente se
    rompe al adoptar inboxes con credenciales propias.
    """
    s = settings()
    inbox = await repo.get_inbox(inbox_id)

    phone_number_id = (inbox and inbox.get("phone_number_id")) or s.meta_phone_number_id
    if inbox and inbox.get("credentials"):
        access_token = crypto.decrypt(bytes(inbox["credentials"]).decode())
    else:
        access_token = s.meta_access_token

    return phone_number_id, access_token
