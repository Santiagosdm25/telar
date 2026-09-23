"""Log de auditoría mínimo -- un insert por cada cambio de credencial
(inbox, tool, proveedor LLM, conexión de base de datos externa). Ver los
call sites en inboxes/router.py, custom_tools/router.py, llm/router.py y
tenant_db/router.py."""

from __future__ import annotations

from uuid import UUID

from telar.db.pool import get_pool

__all__ = ["insert_audit_log"]


async def insert_audit_log(
    account_id: UUID,
    user_id: UUID | None,
    action: str,
    entity_type: str,
    entity_id: UUID | None,
) -> None:
    pool = await get_pool()
    async with pool.connection() as conn:
        await conn.execute(
            "INSERT INTO audit_log (account_id, user_id, action, entity_type, entity_id) "
            "VALUES (%s, %s, %s, %s, %s)",
            (account_id, user_id, action, entity_type, entity_id),
        )
