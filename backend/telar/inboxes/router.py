"""
Administración de inboxes (números de WhatsApp) por HTTP.

Antes registrar un número era un INSERT a mano (ver README, "Registrar tu
número") -- literalmente el primer paso para instalar Telar. El token de
Meta se cifra con el mismo mecanismo que ya usan las tools configurables
(core/crypto.py) antes de guardarse en `inboxes.credentials`.

`webhook_verify_token` no se expone acá a propósito: Meta valida el
handshake del webhook con un solo verify token por app (META_VERIFY_TOKEN
en el .env), no uno distinto por número -- exponer un campo por-inbox que
no tiene ningún efecto en tiempo de ejecución sería confuso.
"""

from __future__ import annotations

from datetime import datetime
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel

from telar.auth.dependencies import Membership, require_role
from telar.auth.roles import AccountRole
from telar.core import crypto
from telar.db import repositories as repo

router = APIRouter(prefix="/accounts/{account_id}/inboxes", tags=["inboxes"])


class CreateInboxRequest(BaseModel):
    name: str
    phone_number_id: str
    waba_id: str | None = None
    access_token: str
    default_team_id: UUID | None = None


class UpdateInboxRequest(BaseModel):
    name: str
    default_team_id: UUID | None = None


class RotateCredentialsRequest(BaseModel):
    phone_number_id: str
    waba_id: str | None = None
    access_token: str


class InboxResponse(BaseModel):
    id: UUID
    name: str
    channel: str
    phone_number_id: str | None
    waba_id: str | None
    default_team_id: UUID | None
    created_at: datetime


async def _get_inbox_or_404(account_id: UUID, inbox_id: UUID) -> dict:
    inbox = await repo.get_inbox(inbox_id)
    if inbox is None or inbox["account_id"] != account_id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Inbox no encontrado")
    return inbox


@router.get("", response_model=list[InboxResponse])
async def list_inboxes(
    account_id: UUID, membership: Membership = Depends(require_role(AccountRole.ADMINISTRATOR))
) -> list[InboxResponse]:
    rows = await repo.get_inboxes_for_account(account_id)
    return [InboxResponse(**row) for row in rows]


@router.post("", response_model=InboxResponse)
async def create_inbox(
    account_id: UUID,
    body: CreateInboxRequest,
    membership: Membership = Depends(require_role(AccountRole.ADMINISTRATOR)),
) -> InboxResponse:
    credentials = crypto.encrypt(body.access_token).encode()
    inbox_id = await repo.insert_inbox(
        account_id, body.name, body.phone_number_id, body.waba_id, credentials,
        body.default_team_id,
    )
    await repo.insert_audit_log(account_id, membership.user_id, "inbox.create", "inbox", inbox_id)
    inbox = await repo.get_inbox(inbox_id)
    return InboxResponse(**inbox)


@router.put("/{inbox_id}", response_model=InboxResponse)
async def update_inbox(
    account_id: UUID,
    inbox_id: UUID,
    body: UpdateInboxRequest,
    membership: Membership = Depends(require_role(AccountRole.ADMINISTRATOR)),
) -> InboxResponse:
    await _get_inbox_or_404(account_id, inbox_id)
    await repo.update_inbox(inbox_id, body.name, body.default_team_id)
    inbox = await repo.get_inbox(inbox_id)
    return InboxResponse(**inbox)


@router.post("/{inbox_id}/rotate-credentials", response_model=InboxResponse)
async def rotate_credentials(
    account_id: UUID,
    inbox_id: UUID,
    body: RotateCredentialsRequest,
    membership: Membership = Depends(require_role(AccountRole.ADMINISTRATOR)),
) -> InboxResponse:
    await _get_inbox_or_404(account_id, inbox_id)
    credentials = crypto.encrypt(body.access_token).encode()
    await repo.update_inbox_credentials(inbox_id, body.phone_number_id, body.waba_id, credentials)
    await repo.insert_audit_log(
        account_id, membership.user_id, "inbox.rotate_credentials", "inbox", inbox_id
    )
    inbox = await repo.get_inbox(inbox_id)
    return InboxResponse(**inbox)
