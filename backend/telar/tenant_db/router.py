"""
Administración de la conexión a la base de datos externa (Postgres o
MySQL) que cada cuenta puede traer -- Configuración → Base de datos.

Guardar la conexión no aprovisiona nada por sí solo (dos pasos separados,
igual que "crear" vs "activar" en llm/router.py): primero se puede probar
sin guardar (test_connection contra lo que hay en el formulario), después
se guarda, y por último se aprovisiona (crea las 3 tablas si no existen).
"""

from __future__ import annotations

from datetime import datetime
from typing import Literal
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel

from telar.auth.dependencies import Membership, require_role
from telar.auth.roles import AccountRole
from telar.core import crypto
from telar.db import repositories as repo
from telar.tenant_db.provisioning import TenantDbError, provision, test_connection

router = APIRouter(prefix="/accounts/{account_id}/database", tags=["tenant-database"])

DatabaseEngine = Literal["postgres", "mysql"]
ConnectionStatus = Literal["disconnected", "connected", "provisioned", "error"]


class DatabaseConnectionResponse(BaseModel):
    engine: DatabaseEngine
    host: str
    port: int
    database_name: str
    username: str
    use_ssl: bool
    status: ConnectionStatus
    last_error: str | None
    provisioned_at: datetime | None
    updated_at: datetime


class SaveDatabaseConnectionRequest(BaseModel):
    engine: DatabaseEngine
    host: str
    port: int
    database_name: str
    username: str
    password: str
    use_ssl: bool = True


class TestConnectionRequest(BaseModel):
    engine: DatabaseEngine
    host: str
    port: int
    database_name: str
    username: str
    password: str
    use_ssl: bool = True


class TestConnectionResponse(BaseModel):
    ok: bool
    error: str | None = None


@router.get("", response_model=DatabaseConnectionResponse | None)
async def get_database_connection(
    account_id: UUID, membership: Membership = Depends(require_role(AccountRole.ADMINISTRATOR))
) -> DatabaseConnectionResponse | None:
    row = await repo.get_account_database_connection(account_id)
    return DatabaseConnectionResponse(**row) if row else None


@router.post("/test", response_model=TestConnectionResponse)
async def test_database_connection(
    account_id: UUID,
    body: TestConnectionRequest,
    membership: Membership = Depends(require_role(AccountRole.ADMINISTRATOR)),
) -> TestConnectionResponse:
    try:
        await test_connection(
            body.engine, body.host, body.port, body.database_name, body.username,
            body.password, body.use_ssl,
        )
    except TenantDbError as e:
        return TestConnectionResponse(ok=False, error=str(e))
    return TestConnectionResponse(ok=True)


@router.put("", response_model=DatabaseConnectionResponse)
async def save_database_connection(
    account_id: UUID,
    body: SaveDatabaseConnectionRequest,
    membership: Membership = Depends(require_role(AccountRole.ADMINISTRATOR)),
) -> DatabaseConnectionResponse:
    encrypted = crypto.encrypt(body.password).encode()
    await repo.upsert_account_database_connection(
        account_id, body.engine, body.host, body.port, body.database_name, body.username,
        encrypted, body.use_ssl,
    )
    await repo.insert_audit_log(
        account_id, membership.user_id, "tenant_db_connection.save", "tenant_db_connection", None
    )
    row = await repo.get_account_database_connection(account_id)
    return DatabaseConnectionResponse(**row)


@router.post("/provision", response_model=DatabaseConnectionResponse)
async def provision_database(
    account_id: UUID,
    membership: Membership = Depends(require_role(AccountRole.ADMINISTRATOR)),
) -> DatabaseConnectionResponse:
    creds = await repo.get_account_database_credentials(account_id)
    if creds is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Todavía no guardaste una conexión")

    password = crypto.decrypt(bytes(creds["password"]).decode())
    try:
        await provision(
            creds["engine"], creds["host"], creds["port"], creds["database_name"],
            creds["username"], password, creds["use_ssl"],
        )
    except TenantDbError as e:
        await repo.set_database_connection_status(account_id, "error", str(e))
        row = await repo.get_account_database_connection(account_id)
        return DatabaseConnectionResponse(**row)

    await repo.mark_database_provisioned(account_id)
    row = await repo.get_account_database_connection(account_id)
    return DatabaseConnectionResponse(**row)


@router.delete("", status_code=status.HTTP_204_NO_CONTENT)
async def delete_database_connection(
    account_id: UUID, membership: Membership = Depends(require_role(AccountRole.ADMINISTRATOR))
) -> None:
    await repo.delete_account_database_connection(account_id)
    await repo.insert_audit_log(
        account_id, membership.user_id, "tenant_db_connection.delete", "tenant_db_connection", None
    )
