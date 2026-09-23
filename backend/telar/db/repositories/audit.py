"""Log de auditoría de cambios de credenciales."""

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
