"""Bots, versiones de grafo y el versionado compartido de la caché de grafos."""

from __future__ import annotations

from uuid import UUID

import json
from psycopg.rows import dict_row

from telar.db.pool import get_pool

__all__ = [
    "get_bot_by_name",
    "insert_bot",
    "get_next_bot_version",
    "insert_bot_version",
    "list_bot_versions",
    "set_active_bot_version",
    "get_active_bot_graph",
    "get_graph_version",
    "bump_graph_version",
    "get_bot_for_account",
    "get_bot_version",
]


async def get_bot_by_name(account_id: UUID, name: str) -> dict | None:
    pool = await get_pool()
    async with pool.connection() as conn:
        cur = await conn.execute(
            "SELECT id, name, active_version_id FROM bots WHERE account_id = %s AND name = %s",
            (account_id, name),
        )
        cur.row_factory = dict_row
        rows = await cur.fetchall()
    return rows[0] if rows else None


async def insert_bot(account_id: UUID, name: str) -> UUID:
    pool = await get_pool()
    async with pool.connection() as conn:
        cur = await conn.execute(
            "INSERT INTO bots (account_id, name) VALUES (%s, %s) RETURNING id",
            (account_id, name),
        )
        row = await cur.fetchone()
    return row[0]


async def get_next_bot_version(bot_id: UUID) -> int:
    pool = await get_pool()
    async with pool.connection() as conn:
        cur = await conn.execute(
            "SELECT COALESCE(MAX(version), 0) + 1 FROM bot_versions WHERE bot_id = %s",
            (bot_id,),
        )
        row = await cur.fetchone()
    return row[0]


async def insert_bot_version(
    bot_id: UUID,
    version: int,
    graph: dict,
    notes: str | None = None,
    created_by: UUID | None = None,
) -> UUID:
    pool = await get_pool()
    async with pool.connection() as conn:
        cur = await conn.execute(
            """
            INSERT INTO bot_versions (bot_id, version, graph, notes, created_by)
            VALUES (%s, %s, %s, %s, %s)
            RETURNING id
            """,
            (bot_id, version, json.dumps(graph), notes, created_by),
        )
        row = await cur.fetchone()
    return row[0]


async def list_bot_versions(bot_id: UUID) -> list[dict]:
    pool = await get_pool()
    async with pool.connection() as conn:
        cur = await conn.execute(
            """
            SELECT bv.id, bv.version, bv.notes, bv.created_by, bv.created_at,
                   bv.id = b.active_version_id AS is_active
              FROM bot_versions bv
              JOIN bots b ON b.id = bv.bot_id
             WHERE bv.bot_id = %s
             ORDER BY bv.version DESC
            """,
            (bot_id,),
        )
        cur.row_factory = dict_row
        return await cur.fetchall()


async def set_active_bot_version(bot_id: UUID, version_id: UUID) -> None:
    pool = await get_pool()
    async with pool.connection() as conn:
        await conn.execute(
            "UPDATE bots SET active_version_id = %s WHERE id = %s",
            (version_id, bot_id),
        )


async def get_active_bot_graph(account_id: UUID) -> dict | None:
    """None si la cuenta no tiene bot, o si lo tiene sin versión activa."""
    pool = await get_pool()
    async with pool.connection() as conn:
        cur = await conn.execute(
            """
            SELECT bv.graph
              FROM bots b
              JOIN bot_versions bv ON bv.id = b.active_version_id
             WHERE b.account_id = %s
            """,
            (account_id,),
        )
        rows = await cur.fetchall()
    return rows[0][0] if rows else None


async def get_graph_version(account_id: UUID) -> int:
    """0 si nunca se invalidó nada para esta cuenta -- ver
    agent/graph_cache.py."""
    pool = await get_pool()
    async with pool.connection() as conn:
        cur = await conn.execute(
            "SELECT version FROM account_graph_versions WHERE account_id = %s",
            (account_id,),
        )
        row = await cur.fetchone()
    return row[0] if row else 0


async def bump_graph_version(account_id: UUID) -> None:
    pool = await get_pool()
    async with pool.connection() as conn:
        await conn.execute(
            """
            INSERT INTO account_graph_versions (account_id, version)
            VALUES (%s, 1)
            ON CONFLICT (account_id) DO UPDATE SET version = account_graph_versions.version + 1
            """,
            (account_id,),
        )


async def get_bot_for_account(account_id: UUID) -> dict | None:
    """
    El bot de la cuenta, sin importar el nombre -- a propósito, para que
    "un bot por cuenta" sea la única forma de crear uno desde acá (el CLI
    deploy_bot.py sigue permitiendo varios por nombre si alguien lo usa
    directo, pero el editor visual no hereda esa ambigüedad).
    """
    pool = await get_pool()
    async with pool.connection() as conn:
        cur = await conn.execute(
            "SELECT id, name, active_version_id FROM bots WHERE account_id = %s",
            (account_id,),
        )
        cur.row_factory = dict_row
        rows = await cur.fetchall()
    return rows[0] if rows else None


async def get_bot_version(version_id: UUID) -> dict | None:
    pool = await get_pool()
    async with pool.connection() as conn:
        cur = await conn.execute(
            "SELECT id, bot_id, version, graph FROM bot_versions WHERE id = %s",
            (version_id,),
        )
        cur.row_factory = dict_row
        rows = await cur.fetchall()
    return rows[0] if rows else None
