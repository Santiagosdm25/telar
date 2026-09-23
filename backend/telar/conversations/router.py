"""Bandeja de entrada: conversaciones atendidas por agentes humanos, contactos e informes."""

from __future__ import annotations

import re
from datetime import datetime, timezone
from typing import Literal
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, Response, status
from pydantic import BaseModel

from telar.auth.dependencies import Membership, require_role
from telar.auth.roles import AccountRole
from telar.channels.meta import default_adapter, resolve_inbox_credentials
from telar.core import state as st
from telar.core.types import (
    ContactRef,
    ConversationStatus,
    MediaRef,
    MessageType,
    OutboundMessage,
    SenderType,
    TemplateRef,
)
from telar.db import repositories as repo
from telar.media import storage as media_storage

router = APIRouter(prefix="/accounts/{account_id}", tags=["conversations"])
adapter = default_adapter()

_ELEVATED_ROLES = (AccountRole.ADMINISTRATOR, AccountRole.SUPERVISOR)


class ConversationResponse(BaseModel):
    id: UUID
    status: str
    assignee_id: UUID | None
    team_id: UUID | None
    contact_id: UUID
    contact_name: str | None
    contact_phone: str | None
    last_contact_message_at: datetime | None


class ConversationStatusResponse(BaseModel):
    id: UUID
    status: str
    assignee_id: UUID | None


class MessageResponse(BaseModel):
    id: UUID
    sender_type: str
    sender_id: UUID | None
    type: str
    content: str | None
    media: MediaRef | None = None
    delivery_status: str
    created_at: datetime


class ConversationDetailResponse(BaseModel):
    id: UUID
    status: str
    assignee_id: UUID | None
    contact_id: UUID
    contact_name: str | None
    contact_phone: str | None
    last_contact_message_at: datetime | None
    messages: list[MessageResponse]


class AssignRequest(BaseModel):
    assignee_id: UUID | None = None  # vacío = tomarla para uno mismo


class ReleaseRequest(BaseModel):
    team_id: UUID | None = None  # vacío = mantener el equipo actual de la conversación


class SendMessageRequest(BaseModel):
    text: str


class ContactResponse(BaseModel):
    id: UUID
    external_id: str
    name: str | None
    phone: str | None
    email: str | None


class StatsResponse(BaseModel):
    bot: int
    pending: int
    open: int
    resolved: int


class CreateTemplateRequest(BaseModel):
    name: str
    language: str = "es"
    components: list[dict] = []


class TemplateResponse(BaseModel):
    id: UUID
    name: str
    language: str
    components: list[dict]


class SendTemplateRequest(BaseModel):
    template_id: UUID
    params: dict[str, str] = {}  # {{1}}, {{2}}... de los componentes con texto variable


async def _get_conversation_or_404(account_id: UUID, conversation_id: UUID):
    conv = await repo.get_conversation(conversation_id)
    if conv is None or conv.account_id != account_id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Conversación no encontrada")
    return conv


@router.get("/conversations", response_model=list[ConversationResponse])
async def list_conversations(
    account_id: UUID,
    status_filter: Literal["bot", "pending", "open", "resolved"] | None = None,
    team_id: UUID | None = None,
    assignee_id: UUID | None = None,
    q: str | None = None,
    limit: int = Query(50, ge=1, le=100),
    offset: int = Query(0, ge=0),
    membership: Membership = Depends(require_role()),
) -> list[ConversationResponse]:
    rows = await repo.get_conversations_for_account(
        account_id, status_filter, team_id, assignee_id, q, limit, offset
    )
    return [
        ConversationResponse(
            id=r["id"],
            status=r["status"],
            assignee_id=r["assignee_id"],
            team_id=r["team_id"],
            contact_id=r["contact_id"],
            contact_name=r["contact_name"],
            contact_phone=r["contact_phone"],
            last_contact_message_at=r["last_contact_message_at"],
        )
        for r in rows
    ]


@router.get("/conversations/{conversation_id}", response_model=ConversationDetailResponse)
async def get_conversation_detail(
    account_id: UUID,
    conversation_id: UUID,
    limit: int = Query(50, ge=1, le=100),
    before: datetime | None = None,
    membership: Membership = Depends(require_role()),
) -> ConversationDetailResponse:
    conv = await _get_conversation_or_404(account_id, conversation_id)
    messages = await repo.get_messages_for_conversation(conversation_id, limit=limit, before=before)
    contact = await repo.get_contact(conv.contact_id)
    return ConversationDetailResponse(
        id=conv.id,
        status=conv.status.value,
        assignee_id=conv.assignee_id,
        contact_id=conv.contact_id,
        contact_name=contact["name"] if contact else None,
        contact_phone=contact["phone"] if contact else None,
        last_contact_message_at=conv.last_contact_message_at,
        messages=[MessageResponse(**m) for m in messages],
    )


@router.post("/conversations/{conversation_id}/assign", response_model=ConversationStatusResponse)
async def assign_conversation(
    account_id: UUID,
    conversation_id: UUID,
    body: AssignRequest,
    membership: Membership = Depends(require_role()),
) -> ConversationStatusResponse:
    conv = await _get_conversation_or_404(account_id, conversation_id)
    expected_status, expected_assignee_id = conv.status, conv.assignee_id

    target_id = body.assignee_id or membership.user_id
    is_self = target_id == membership.user_id
    can_assign_others = membership.is_superadmin or membership.role in _ELEVATED_ROLES
    if not is_self and not can_assign_others:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "No podés asignar a otra persona")

    try:
        if conv.status is ConversationStatus.OPEN:
            # Cambia solo el asignado, no el estado.
            conv.assignee_id = target_id
        else:
            st.transition(conv, ConversationStatus.OPEN, assignee_id=target_id)
    except st.InvalidTransition as e:
        raise HTTPException(status.HTTP_409_CONFLICT, str(e)) from e

    # Condicionado al estado leído: si otro agente la tomó en el medio, esta request pierde.
    ok = await repo.save_conversation_if_unchanged(conv, expected_status, expected_assignee_id)
    if not ok:
        raise HTTPException(status.HTTP_409_CONFLICT, "Alguien ya tomó esta conversación, recargá")

    return ConversationStatusResponse(id=conv.id, status=conv.status.value, assignee_id=conv.assignee_id)


@router.post("/conversations/{conversation_id}/resolve", response_model=ConversationStatusResponse)
async def resolve_conversation(
    account_id: UUID,
    conversation_id: UUID,
    membership: Membership = Depends(require_role()),
) -> ConversationStatusResponse:
    conv = await _get_conversation_or_404(account_id, conversation_id)

    try:
        st.transition(conv, ConversationStatus.RESOLVED)
    except st.InvalidTransition as e:
        raise HTTPException(status.HTTP_409_CONFLICT, str(e)) from e

    await repo.save_conversation(conv)
    return ConversationStatusResponse(id=conv.id, status=conv.status.value, assignee_id=conv.assignee_id)


@router.post("/conversations/{conversation_id}/release", response_model=ConversationStatusResponse)
async def release_conversation(
    account_id: UUID,
    conversation_id: UUID,
    body: ReleaseRequest = ReleaseRequest(),
    membership: Membership = Depends(require_role()),
) -> ConversationStatusResponse:
    conv = await _get_conversation_or_404(account_id, conversation_id)

    try:
        st.request_handoff(conv, team_id=body.team_id or conv.team_id)
    except st.InvalidTransition as e:
        raise HTTPException(status.HTTP_409_CONFLICT, str(e)) from e

    await repo.save_conversation(conv)
    return ConversationStatusResponse(id=conv.id, status=conv.status.value, assignee_id=conv.assignee_id)


@router.post("/conversations/{conversation_id}/messages", response_model=MessageResponse)
async def send_message(
    account_id: UUID,
    conversation_id: UUID,
    body: SendMessageRequest,
    membership: Membership = Depends(require_role()),
) -> MessageResponse:
    conv = await _get_conversation_or_404(account_id, conversation_id)

    if conv.status is not ConversationStatus.OPEN:
        raise HTTPException(
            status.HTTP_409_CONFLICT, "Hay que tomar la conversación antes de responder"
        )

    is_owner = conv.assignee_id == membership.user_id
    can_override = membership.is_superadmin or membership.role in _ELEVATED_ROLES
    if not is_owner and not can_override:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Esta conversación la tiene otra persona")

    if not st.window_is_open(conv):
        raise HTTPException(
            status.HTTP_409_CONFLICT, "Ventana de 24h cerrada, se necesita una plantilla"
        )

    contact = await repo.get_contact(conv.contact_id)
    if contact is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Contacto no encontrado")

    out = OutboundMessage(
        conversation_id=conv.id,
        sender_type=SenderType.AGENT,
        sender_id=membership.user_id,
        text=body.text,
    )
    contact_ref = ContactRef(
        external_id=contact["external_id"], name=contact["name"], phone=contact["phone"]
    )
    phone_number_id, access_token = await resolve_inbox_credentials(conv.inbox_id)
    result = await adapter.send(
        out, contact_ref, phone_number_id=phone_number_id, access_token=access_token
    )
    saved_id = await repo.save_outbound(out, account_id, conv.inbox_id, result.channel_message_id)

    if not result.ok:
        raise HTTPException(
            status.HTTP_502_BAD_GATEWAY, f"No se pudo enviar: {result.error_message}"
        )

    return MessageResponse(
        id=saved_id,
        sender_type=SenderType.AGENT.value,
        sender_id=membership.user_id,
        type="text",
        content=body.text,
        delivery_status="sent" if result.channel_message_id else "failed",
        created_at=datetime.now(timezone.utc),
    )


_TEMPLATE_PLACEHOLDER = re.compile(r"\{\{(\d+)\}\}")


def _substitute_template_params(components: list[dict], params: dict[str, str]) -> list[dict]:
    """Convierte los componentes guardados al formato de envío de Meta.

    422 si falta un valor: no se manda "{{1}}" literal a un cliente.
    """
    substituted: list[dict] = []
    for component in components:
        placeholders = _TEMPLATE_PLACEHOLDER.findall(component.get("text", ""))
        if not placeholders:
            continue
        parameters = []
        for n in placeholders:
            if n not in params:
                raise HTTPException(
                    status.HTTP_422_UNPROCESSABLE_ENTITY,
                    f"Falta el valor de la variable {{{{{n}}}}} de la plantilla",
                )
            parameters.append({"type": "text", "text": params[n]})
        substituted.append({"type": component["type"], "parameters": parameters})
    return substituted


@router.post(
    "/conversations/{conversation_id}/messages/template", response_model=MessageResponse
)
async def send_template_message(
    account_id: UUID,
    conversation_id: UUID,
    body: SendTemplateRequest,
    membership: Membership = Depends(require_role()),
) -> MessageResponse:
    """Ignora window_is_open a propósito: las plantillas existen para escribir fuera de ella."""
    conv = await _get_conversation_or_404(account_id, conversation_id)

    is_owner = conv.assignee_id == membership.user_id
    can_override = membership.is_superadmin or membership.role in _ELEVATED_ROLES
    if conv.status is ConversationStatus.OPEN and not is_owner and not can_override:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Esta conversación la tiene otra persona")

    template = await repo.get_message_template(body.template_id)
    if template is None or template["account_id"] != account_id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Plantilla no encontrada")

    contact = await repo.get_contact(conv.contact_id)
    if contact is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Contacto no encontrado")

    template_ref = TemplateRef(
        name=template["name"],
        language=template["language"],
        components=_substitute_template_params(template["components"], body.params),
    )
    # Con `template`, Meta no recibe este texto; solo sirve para mostrarlo en el hilo.
    display_text = f"[plantilla] {template['name']}"
    out = OutboundMessage(
        conversation_id=conv.id,
        sender_type=SenderType.AGENT,
        sender_id=membership.user_id,
        type=MessageType.TEMPLATE,
        text=display_text,
        template=template_ref,
    )
    contact_ref = ContactRef(
        external_id=contact["external_id"], name=contact["name"], phone=contact["phone"]
    )
    phone_number_id, access_token = await resolve_inbox_credentials(conv.inbox_id)
    result = await adapter.send(
        out, contact_ref, phone_number_id=phone_number_id, access_token=access_token
    )
    saved_id = await repo.save_outbound(out, account_id, conv.inbox_id, result.channel_message_id)

    if not result.ok:
        raise HTTPException(
            status.HTTP_502_BAD_GATEWAY, f"No se pudo enviar: {result.error_message}"
        )

    return MessageResponse(
        id=saved_id,
        sender_type=SenderType.AGENT.value,
        sender_id=membership.user_id,
        type="template",
        content=display_text,
        delivery_status="sent" if result.channel_message_id else "failed",
        created_at=datetime.now(timezone.utc),
    )


@router.get("/conversations/{conversation_id}/messages/{message_id}/media")
async def get_message_media(
    account_id: UUID,
    conversation_id: UUID,
    message_id: UUID,
    membership: Membership = Depends(require_role()),
) -> Response:
    """Sirve el archivo descargado de Meta, con el mismo control de acceso que el hilo."""
    await _get_conversation_or_404(account_id, conversation_id)

    msg = await repo.get_message(message_id)
    if msg is None or msg["conversation_id"] != conversation_id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Mensaje no encontrado")

    media = msg["media"]
    external_id = media.get("external_id") if media else None
    if not external_id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Este mensaje no tiene un archivo adjunto")

    content = await media_storage.read(external_id)
    if content is None:
        raise HTTPException(
            status.HTTP_404_NOT_FOUND,
            "El archivo no está disponible (no se pudo descargar en su momento o es de antes de esta función)",
        )

    return Response(
        content=content,
        media_type=media.get("mime_type") or "application/octet-stream",
    )


@router.get("/contacts", response_model=list[ContactResponse])
async def list_contacts(
    account_id: UUID,
    q: str | None = None,
    limit: int = Query(50, ge=1, le=100),
    offset: int = Query(0, ge=0),
    membership: Membership = Depends(require_role()),
) -> list[ContactResponse]:
    rows = await repo.get_contacts_for_account(account_id, q, limit, offset)
    return [
        ContactResponse(
            id=r["id"],
            external_id=r["external_id"],
            name=r["name"],
            phone=r["phone"],
            email=r["email"],
        )
        for r in rows
    ]


@router.get("/stats", response_model=StatsResponse)
async def get_stats(
    account_id: UUID, membership: Membership = Depends(require_role())
) -> StatsResponse:
    counts = await repo.get_conversation_stats(account_id)
    return StatsResponse(**counts)


@router.get("/templates", response_model=list[TemplateResponse])
async def list_templates(
    account_id: UUID, membership: Membership = Depends(require_role())
) -> list[TemplateResponse]:
    rows = await repo.get_message_templates_for_account(account_id)
    return [TemplateResponse(**row) for row in rows]


@router.post("/templates", response_model=TemplateResponse)
async def create_template(
    account_id: UUID,
    body: CreateTemplateRequest,
    membership: Membership = Depends(require_role(AccountRole.ADMINISTRATOR)),
) -> TemplateResponse:
    """Registra una plantilla ya aprobada en Meta; Telar no la crea allá."""
    template_id = await repo.insert_message_template(
        account_id, body.name, body.language, body.components
    )
    return TemplateResponse(
        id=template_id, name=body.name, language=body.language, components=body.components
    )


@router.delete("/templates/{template_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_template(
    account_id: UUID,
    template_id: UUID,
    membership: Membership = Depends(require_role(AccountRole.ADMINISTRATOR)),
) -> None:
    template = await repo.get_message_template(template_id)
    if template is None or template["account_id"] != account_id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Plantilla no encontrada")
    await repo.delete_message_template(template_id)
