"""Inboxes de WhatsApp (un número/conexión por inbox)."""

from __future__ import annotations

from uuid import UUID

from psycopg.rows import dict_row

from telar.db.pool import get_pool

__all__ = [
    "resolve_inbox",
    "get_inbox_default_team",
    "insert_inbox",
    "get_inboxes_for_account",
    "get_inbox_setup_rows",
    "get_inbox",
    "update_inbox",
    "update_inbox_credentials",
]


async def resolve_inbox(phone_number_id: str) -> dict | None:
    """El phone_number_id del webhook es la llave de enrutamiento."""
    pool = await get_pool()
    async with pool.connection() as conn:
        cur = await conn.execute(
            "SELECT id, account_id, default_team_id "
            "FROM inboxes WHERE phone_number_id = %s",
            (phone_number_id,),
        )
        cur.row_factory = dict_row
        rows = await cur.fetchall()
    return rows[0] if rows else None


async def get_inbox_default_team(inbox_id: UUID) -> UUID | None:
    pool = await get_pool()
    async with pool.connection() as conn:
        cur = await conn.execute(
            "SELECT default_team_id FROM inboxes WHERE id = %s", (inbox_id,)
        )
        row = await cur.fetchone()
    return row[0] if row else None


async def insert_inbox(
    account_id: UUID,
    name: str,
    phone_number_id: str,
    waba_id: str | None,
    credentials: bytes | None,
    default_team_id: UUID | None,
) -> UUID:
    pool = await get_pool()
    async with pool.connection() as conn:
        cur = await conn.execute(
            """
            INSERT INTO inboxes (account_id, name, phone_number_id, waba_id, credentials, default_team_id)
            VALUES (%s, %s, %s, %s, %s, %s)
            RETURNING id
            """,
            (account_id, name, phone_number_id, waba_id, credentials, default_team_id),
        )
        row = await cur.fetchone()
    return row[0]


async def get_inboxes_for_account(account_id: UUID) -> list[dict]:
    pool = await get_pool()
    async with pool.connection() as conn:
        cur = await conn.execute(
            "SELECT id, name, channel, phone_number_id, waba_id, default_team_id, created_at "
            "FROM inboxes WHERE account_id = %s ORDER BY name",
            (account_id,),
        )
        cur.row_factory = dict_row
        return await cur.fetchall()


async def get_inbox_setup_rows(account_id: UUID) -> list[dict]:
    """Para el wizard: si hay número y si ya tiene token cifrado (sin devolverlo)."""
    pool = await get_pool()
    async with pool.connection() as conn:
        cur = await conn.execute(
            """
            SELECT name, phone_number_id,
                   (credentials IS NOT NULL) AS has_credentials
              FROM inboxes
             WHERE account_id = %s
             ORDER BY created_at
            """,
            (account_id,),
        )
        cur.row_factory = dict_row
        return await cur.fetchall()


async def get_inbox(inbox_id: UUID) -> dict | None:
    pool = await get_pool()
    async with pool.connection() as conn:
        cur = await conn.execute(
            "SELECT id, account_id, name, channel, phone_number_id, waba_id, "
            "credentials, default_team_id, created_at FROM inboxes WHERE id = %s",
            (inbox_id,),
        )
        cur.row_factory = dict_row
        rows = await cur.fetchall()
    return rows[0] if rows else None


async def update_inbox(
    inbox_id: UUID, name: str, default_team_id: UUID | None
) -> None:
    pool = await get_pool()
    async with pool.connection() as conn:
        await conn.execute(
            "UPDATE inboxes SET name = %s, default_team_id = %s WHERE id = %s",
            (name, default_team_id, inbox_id),
        )


async def update_inbox_credentials(
    inbox_id: UUID, phone_number_id: str, waba_id: str | None, credentials: bytes | None
) -> None:
    pool = await get_pool()
    async with pool.connection() as conn:
        await conn.execute(
            "UPDATE inboxes SET phone_number_id = %s, waba_id = %s, credentials = %s WHERE id = %s",
            (phone_number_id, waba_id, credentials, inbox_id),
        )
