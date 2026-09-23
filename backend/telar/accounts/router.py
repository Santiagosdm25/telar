"""
Endpoints de cuentas, membresía y equipos.

administrator gestiona quién pertenece a la cuenta y qué equipos existen;
supervisor puede sumar/sacar *asesores* (nunca administradores ni otros
supervisores -- ver _guard_supervisor_role) y mover gente dentro/fuera de
un equipo, pero no crear equipos ni la cuenta misma; agent no gestiona
nada de esto. Ni supervisor ni agent pueden tocar inboxes, proveedor LLM,
tools, bases de conocimiento, base de datos de la cuenta ni el hilo del
bot -- esos routers exigen ADMINISTRATOR aparte, sin cambios acá.
"""

from __future__ import annotations

import secrets
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel

from telar.accounts.setup import graph_has_custom_prompt, next_setup_step
from telar.auth.dependencies import Membership, get_current_user, require_role
from telar.auth.roles import AccountRole
from telar.auth.security import hash_password
from telar.config import settings
from telar.db import repositories as repo

router = APIRouter(prefix="/accounts", tags=["accounts"])


class CreateAccountRequest(BaseModel):
    name: str


class AccountResponse(BaseModel):
    id: UUID
    name: str


class SetupStatusResponse(BaseModel):
    """Semáforo del happy path: número, modelo, instrucciones."""

    ready: bool
    complete: bool
    next_step: str
    has_inbox: bool
    has_inbox_credentials: bool
    uses_env_credentials: bool
    has_active_llm: bool
    uses_default_llm: bool
    has_custom_prompt: bool
    inbox_name: str | None
    webhook_path: str


class AddMemberRequest(BaseModel):
    email: str
    role: AccountRole
    name: str | None = None  # requerido solo si el email todavía no tiene usuario


class MemberResponse(BaseModel):
    user_id: UUID
    email: str
    name: str
    role: str
    temporary_password: str | None = None  # presente una sola vez: se creó el usuario ahora


class CreateTeamRequest(BaseModel):
    name: str


class TeamResponse(BaseModel):
    id: UUID
    name: str


class TeamMemberRequest(BaseModel):
    user_id: UUID


class TeamMemberResponse(BaseModel):
    user_id: UUID
    email: str
    name: str


@router.post("", response_model=AccountResponse)
async def create_account(
    body: CreateAccountRequest, user: dict = Depends(get_current_user)
) -> AccountResponse:
    if not user["is_superadmin"]:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Solo un superadmin puede crear cuentas")

    account_id = await repo.insert_account(body.name)
    # Sin esto, la cuenta queda sin ningún administrator real -- solo
    # accesible por el bypass de superadmin. Quien la crea queda como su
    # primer administrador, igual que pasaría si se sumara a sí mismo desde
    # Equipo después.
    await repo.insert_account_membership(account_id, user["id"], AccountRole.ADMINISTRATOR.value)
    return AccountResponse(id=account_id, name=body.name)


@router.get("", response_model=list[AccountResponse])
async def list_accounts(user: dict = Depends(get_current_user)) -> list[AccountResponse]:
    if user["is_superadmin"]:
        rows = await repo.get_all_accounts()
    else:
        rows = await repo.get_accounts_for_user(user["id"])
    return [AccountResponse(**row) for row in rows]


def _guard_supervisor_role(membership: Membership, role: AccountRole) -> None:
    """Un supervisor puede sumar o sacar asesores, nunca administradores ni
    otros supervisores -- evita que se autopromueva o promueva a alguien
    más sin pasar por un administrator real. Superadmin y administrator no
    tienen esta restricción."""
    if membership.is_superadmin or membership.role == AccountRole.ADMINISTRATOR:
        return
    if role != AccountRole.AGENT:
        raise HTTPException(
            status.HTTP_403_FORBIDDEN, "Un supervisor solo puede sumar o sacar asesores"
        )


@router.post("/{account_id}/members", response_model=MemberResponse)
async def add_member(
    account_id: UUID,
    body: AddMemberRequest,
    membership: Membership = Depends(
        require_role(AccountRole.ADMINISTRATOR, AccountRole.SUPERVISOR)
    ),
) -> MemberResponse:
    _guard_supervisor_role(membership, body.role)
    target = await repo.get_user_by_email(body.email)
    temporary_password: str | None = None

    if target is None:
        # No hay infraestructura de invitación por email en el proyecto: se
        # crea el usuario acá mismo con una contraseña temporal que el
        # administrador comparte fuera de banda. El usuario la cambia con
        # POST /auth/change-password en su primer login.
        if not body.name:
            raise HTTPException(
                status.HTTP_422_UNPROCESSABLE_ENTITY,
                "No existe un usuario con ese email. Mandá 'name' para crearlo de una.",
            )
        temporary_password = secrets.token_urlsafe(12)
        user_id = await repo.insert_user(body.email, body.name, hash_password(temporary_password))
        target = {"id": user_id, "email": body.email, "name": body.name}

    await repo.insert_account_membership(account_id, target["id"], body.role.value)
    return MemberResponse(
        user_id=target["id"],
        email=target["email"],
        name=target["name"],
        role=body.role.value,
        temporary_password=temporary_password,
    )


@router.get("/{account_id}/members", response_model=list[MemberResponse])
async def list_members(
    account_id: UUID, membership: Membership = Depends(require_role())
) -> list[MemberResponse]:
    rows = await repo.get_account_members(account_id)
    return [MemberResponse(**row) for row in rows]


@router.delete("/{account_id}/members/{user_id}", status_code=status.HTTP_204_NO_CONTENT)
async def remove_member(
    account_id: UUID,
    user_id: UUID,
    membership: Membership = Depends(
        require_role(AccountRole.ADMINISTRATOR, AccountRole.SUPERVISOR)
    ),
) -> None:
    target = await repo.get_account_membership(account_id, user_id)
    target_role = AccountRole(target["role"]) if target else None

    if not (membership.is_superadmin or membership.role == AccountRole.ADMINISTRATOR):
        _guard_supervisor_role(membership, target_role or AccountRole.ADMINISTRATOR)

    if target_role is AccountRole.ADMINISTRATOR and await repo.count_administrators(account_id) <= 1:
        raise HTTPException(
            status.HTTP_409_CONFLICT, "No podés sacar al último administrador de la cuenta"
        )

    await repo.delete_account_membership(account_id, user_id)


@router.post("/{account_id}/teams", response_model=TeamResponse)
async def create_team(
    account_id: UUID,
    body: CreateTeamRequest,
    membership: Membership = Depends(require_role(AccountRole.ADMINISTRATOR)),
) -> TeamResponse:
    team_id = await repo.insert_team(account_id, body.name)
    return TeamResponse(id=team_id, name=body.name)


@router.get("/{account_id}/setup", response_model=SetupStatusResponse)
async def get_setup_status(
    account_id: UUID, membership: Membership = Depends(require_role())
) -> SetupStatusResponse:
    """Cualquier miembro puede ver si el bot está listo; configurar es de admin."""
    del membership
    inboxes = await repo.get_inbox_setup_rows(account_id)
    active_llm = await repo.get_active_llm_provider(account_id)
    graph = await repo.get_active_bot_graph(account_id)
    s = settings()

    has_inbox = bool(inboxes)
    has_inbox_credentials = any(row["has_credentials"] for row in inboxes)
    uses_env_credentials = bool(s.meta_access_token) and not has_inbox_credentials
    has_active_llm = active_llm is not None
    has_custom_prompt = graph_has_custom_prompt(graph)
    step = next_setup_step(
        has_inbox=has_inbox,
        has_active_llm=has_active_llm,
        has_custom_prompt=has_custom_prompt,
    )
    can_send = has_inbox and (has_inbox_credentials or uses_env_credentials)
    complete = step == "done" and can_send

    return SetupStatusResponse(
        ready=can_send,
        complete=complete,
        next_step=step,
        has_inbox=has_inbox,
        has_inbox_credentials=has_inbox_credentials,
        uses_env_credentials=uses_env_credentials,
        has_active_llm=has_active_llm,
        uses_default_llm=not has_active_llm and bool(s.default_model),
        has_custom_prompt=has_custom_prompt,
        inbox_name=inboxes[0]["name"] if inboxes else None,
        webhook_path="/webhooks/whatsapp",
    )


@router.get("/{account_id}/teams", response_model=list[TeamResponse])
async def list_teams(
    account_id: UUID, membership: Membership = Depends(require_role())
) -> list[TeamResponse]:
    rows = await repo.get_teams_for_account(account_id)
    return [TeamResponse(**row) for row in rows]


@router.get("/{account_id}/teams/{team_id}/members", response_model=list[TeamMemberResponse])
async def list_team_members(
    account_id: UUID, team_id: UUID, membership: Membership = Depends(require_role())
) -> list[TeamMemberResponse]:
    rows = await repo.get_team_members(team_id)
    return [TeamMemberResponse(**row) for row in rows]


@router.post("/{account_id}/teams/{team_id}/members", status_code=status.HTTP_204_NO_CONTENT)
async def add_team_member(
    account_id: UUID,
    team_id: UUID,
    body: TeamMemberRequest,
    membership: Membership = Depends(
        require_role(AccountRole.ADMINISTRATOR, AccountRole.SUPERVISOR)
    ),
) -> None:
    await repo.insert_team_member(team_id, body.user_id)


@router.delete(
    "/{account_id}/teams/{team_id}/members/{user_id}",
    status_code=status.HTTP_204_NO_CONTENT,
)
async def remove_team_member(
    account_id: UUID,
    team_id: UUID,
    user_id: UUID,
    membership: Membership = Depends(
        require_role(AccountRole.ADMINISTRATOR, AccountRole.SUPERVISOR)
    ),
) -> None:
    await repo.delete_team_member(team_id, user_id)
