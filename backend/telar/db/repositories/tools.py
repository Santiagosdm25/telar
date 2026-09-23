"""Tools configurables (http/sql/document) por cuenta."""

from __future__ import annotations

import json
from uuid import UUID

from psycopg.rows import dict_row

from telar.db.pool import get_pool

__all__ = [
    "get_tools_for_account",
    "insert_tool",
    "get_tools_for_account_admin",
    "get_tool",
    "update_tool",
    "update_tool_secret",
    "delete_tool",
]


async def get_tools_for_account(account_id: UUID) -> list[dict]:
    pool = await get_pool()
    async with pool.connection() as conn:
        cur = await conn.execute(
            "SELECT id, name, description, kind, config, schema, secret_config "
            "FROM tools WHERE account_id = %s AND enabled = true",
            (account_id,),
        )
        cur.row_factory = dict_row
        return await cur.fetchall()


async def insert_tool(
    account_id: UUID,
    name: str,
    description: str,
    kind: str,
    config: dict,
    secret_config: bytes | None,
    schema: dict,
) -> UUID:
    pool = await get_pool()
    async with pool.connection() as conn:
        cur = await conn.execute(
            """
            INSERT INTO tools (account_id, name, description, kind, config, secret_config, schema)
            VALUES (%s, %s, %s, %s, %s, %s, %s)
            RETURNING id
            """,
            (
                account_id,
                name,
                description,
                kind,
                json.dumps(config),
                secret_config,
                json.dumps(schema),
            ),
        )
        row = await cur.fetchone()
    return row[0]


async def get_tools_for_account_admin(account_id: UUID) -> list[dict]:
    """Todas las tools de la cuenta (incluidas las deshabilitadas), sin el secreto."""
    pool = await get_pool()
    async with pool.connection() as conn:
        cur = await conn.execute(
            "SELECT id, name, description, kind, config, schema, enabled "
            "FROM tools WHERE account_id = %s ORDER BY name",
            (account_id,),
        )
        cur.row_factory = dict_row
        return await cur.fetchall()


async def get_tool(tool_id: UUID) -> dict | None:
    pool = await get_pool()
    async with pool.connection() as conn:
        cur = await conn.execute(
            "SELECT id, account_id, name, description, kind, config, schema, "
            "secret_config, enabled FROM tools WHERE id = %s",
            (tool_id,),
        )
        cur.row_factory = dict_row
        rows = await cur.fetchall()
    return rows[0] if rows else None


async def update_tool(
    tool_id: UUID, name: str, description: str, config: dict, schema: dict, enabled: bool
) -> None:
    pool = await get_pool()
    async with pool.connection() as conn:
        await conn.execute(
            """
            UPDATE tools
               SET name = %s, description = %s, config = %s, schema = %s, enabled = %s
             WHERE id = %s
            """,
            (name, description, json.dumps(config), json.dumps(schema), enabled, tool_id),
        )


async def update_tool_secret(tool_id: UUID, secret_config: bytes | None) -> None:
    pool = await get_pool()
    async with pool.connection() as conn:
        await conn.execute(
            "UPDATE tools SET secret_config = %s WHERE id = %s", (secret_config, tool_id)
        )


async def delete_tool(tool_id: UUID) -> None:
    pool = await get_pool()
    async with pool.connection() as conn:
        await conn.execute("DELETE FROM tools WHERE id = %s", (tool_id,))
