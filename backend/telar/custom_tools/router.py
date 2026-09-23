"""
Administración de tools configurables (http/sql) por HTTP -- la contraparte
del CLI create_tool.py. El `kind` de una tool no se puede cambiar después
de creada (cambiar de http a sql implica reescribir config/schema desde
cero); si hace falta, se borra y se crea de nuevo.
"""

from __future__ import annotations

from typing import Any, Literal
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, ConfigDict, Field

from telar.auth.dependencies import Membership, require_role
from telar.auth.roles import AccountRole
from telar.custom_tools import service
from telar.db import repositories as repo

router = APIRouter(prefix="/accounts/{account_id}/tools", tags=["tools"])

# `schema` es el nombre de la columna real y lo que espera el frontend, pero
# BaseModel.schema() (aunque deprecado en pydantic v2) dispara un warning si
# se usa el nombre tal cual -- se alía el atributo Python a `schema_` y se
# serializa como `schema` hacia afuera.
_SCHEMA_FIELD = Field(alias="schema")


class ToolResponse(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    id: UUID
    name: str
    description: str
    kind: str
    config: dict[str, Any]
    schema_: dict[str, Any] = _SCHEMA_FIELD


class ToolAdminResponse(ToolResponse):
    enabled: bool


class CreateToolRequest(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    name: str
    description: str
    kind: Literal["http", "sql", "document"]
    config: dict[str, Any]
    secret: dict[str, Any] | None = None
    schema_: dict[str, Any] = Field(default_factory=dict, alias="schema")


class UpdateToolRequest(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    name: str
    description: str
    config: dict[str, Any]
    schema_: dict[str, Any] = Field(default_factory=dict, alias="schema")
    enabled: bool = True
    secret: dict[str, Any] | None = None  # None = no tocar el secreto guardado


async def _get_tool_or_404(account_id: UUID, tool_id: UUID) -> dict:
    tool = await repo.get_tool(tool_id)
    if tool is None or tool["account_id"] != account_id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Tool no encontrada")
    return tool


@router.get("", response_model=list[ToolAdminResponse])
async def list_tools(
    account_id: UUID, membership: Membership = Depends(require_role(AccountRole.ADMINISTRATOR))
) -> list[ToolAdminResponse]:
    rows = await repo.get_tools_for_account_admin(account_id)
    return [ToolAdminResponse(**row) for row in rows]


@router.post("", response_model=ToolResponse)
async def create_tool(
    account_id: UUID,
    body: CreateToolRequest,
    membership: Membership = Depends(require_role(AccountRole.ADMINISTRATOR)),
) -> ToolResponse:
    try:
        tool_id = await service.create_tool(
            account_id, body.name, body.description, body.kind, body.config, body.secret,
            body.schema_,
        )
    except service.ToolValidationError as e:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, str(e)) from e

    await repo.insert_audit_log(account_id, membership.user_id, "tool.create", "tool", tool_id)
    return ToolResponse(
        id=tool_id, name=body.name, description=body.description, kind=body.kind,
        config=body.config, schema_=body.schema_,
    )


@router.patch("/{tool_id}", response_model=ToolAdminResponse)
async def update_tool(
    account_id: UUID,
    tool_id: UUID,
    body: UpdateToolRequest,
    membership: Membership = Depends(require_role(AccountRole.ADMINISTRATOR)),
) -> ToolAdminResponse:
    existing = await _get_tool_or_404(account_id, tool_id)
    try:
        await service.update_tool(
            account_id, tool_id, body.name, body.description, existing["kind"], body.config,
            body.schema_, body.enabled, body.secret,
        )
    except service.ToolValidationError as e:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, str(e)) from e

    if body.secret is not None:
        await repo.insert_audit_log(
            account_id, membership.user_id, "tool.update_secret", "tool", tool_id
        )

    return ToolAdminResponse(
        id=tool_id, name=body.name, description=body.description, kind=existing["kind"],
        config=body.config, schema_=body.schema_, enabled=body.enabled,
    )


@router.delete("/{tool_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_tool(
    account_id: UUID,
    tool_id: UUID,
    membership: Membership = Depends(require_role(AccountRole.ADMINISTRATOR)),
) -> None:
    await _get_tool_or_404(account_id, tool_id)
    await service.delete_tool(account_id, tool_id)
    await repo.insert_audit_log(account_id, membership.user_id, "tool.delete", "tool", tool_id)
