"""Cuentas, membresías y equipos."""

from __future__ import annotations

from uuid import UUID

from psycopg.rows import dict_row

from telar.db.pool import get_pool

__all__ = [
    "insert_account",
    "get_all_accounts",
    "get_accounts_for_user",
    "get_account_membership",
    "insert_account_membership",
    "delete_account_membership",
    "count_administrators",
    "get_account_members",
    "insert_team",
    "get_teams_for_account",
    "insert_team_member",
    "delete_team_member",
    "get_team_members",
]


async def insert_account(name: str) -> UUID:
    pool = await get_pool()
    async with pool.connection() as conn:
        cur = await conn.execute(
            "INSERT INTO accounts (name) VALUES (%s) RETURNING id", (name,)
        )
        row = await cur.fetchone()
    return row[0]


async def get_all_accounts() -> list[dict]:
    pool = await get_pool()
    async with pool.connection() as conn:
        cur = await conn.execute("SELECT id, name FROM accounts ORDER BY name")
        cur.row_factory = dict_row
        return await cur.fetchall()


async def get_accounts_for_user(user_id: UUID) -> list[dict]:
    pool = await get_pool()
    async with pool.connection() as conn:
        cur = await conn.execute(
            """
            SELECT a.id, a.name
              FROM accounts a
              JOIN account_users au ON au.account_id = a.id
             WHERE au.user_id = %s
             ORDER BY a.name
            """,
            (user_id,),
        )
        cur.row_factory = dict_row
        return await cur.fetchall()


async def get_account_membership(account_id: UUID, user_id: UUID) -> dict | None:
    pool = await get_pool()
    async with pool.connection() as conn:
        cur = await conn.execute(
            "SELECT account_id, user_id, role FROM account_users "
            "WHERE account_id = %s AND user_id = %s",
            (account_id, user_id),
        )
        cur.row_factory = dict_row
        rows = await cur.fetchall()
    return rows[0] if rows else None


async def insert_account_membership(account_id: UUID, user_id: UUID, role: str) -> None:
    pool = await get_pool()
    async with pool.connection() as conn:
        await conn.execute(
            """
            INSERT INTO account_users (account_id, user_id, role)
            VALUES (%s, %s, %s)
            ON CONFLICT (account_id, user_id) DO UPDATE SET role = EXCLUDED.role
            """,
            (account_id, user_id, role),
        )


async def delete_account_membership(account_id: UUID, user_id: UUID) -> None:
    pool = await get_pool()
    async with pool.connection() as conn:
        await conn.execute(
            "DELETE FROM account_users WHERE account_id = %s AND user_id = %s",
            (account_id, user_id),
        )


async def count_administrators(account_id: UUID) -> int:
    pool = await get_pool()
    async with pool.connection() as conn:
        cur = await conn.execute(
            "SELECT count(*) FROM account_users WHERE account_id = %s AND role = 'administrator'",
            (account_id,),
        )
        row = await cur.fetchone()
    return row[0]


async def get_account_members(account_id: UUID) -> list[dict]:
    pool = await get_pool()
    async with pool.connection() as conn:
        cur = await conn.execute(
            """
            SELECT u.id AS user_id, u.email, u.name, au.role
              FROM account_users au
              JOIN users u ON u.id = au.user_id
             WHERE au.account_id = %s
             ORDER BY u.name
            """,
            (account_id,),
        )
        cur.row_factory = dict_row
        return await cur.fetchall()


async def insert_team(account_id: UUID, name: str) -> UUID:
    pool = await get_pool()
    async with pool.connection() as conn:
        cur = await conn.execute(
            "INSERT INTO teams (account_id, name) VALUES (%s, %s) RETURNING id",
            (account_id, name),
        )
        row = await cur.fetchone()
    return row[0]


async def get_teams_for_account(account_id: UUID) -> list[dict]:
    pool = await get_pool()
    async with pool.connection() as conn:
        cur = await conn.execute(
            "SELECT id, name FROM teams WHERE account_id = %s ORDER BY name",
            (account_id,),
        )
        cur.row_factory = dict_row
        return await cur.fetchall()


async def insert_team_member(team_id: UUID, user_id: UUID) -> None:
    pool = await get_pool()
    async with pool.connection() as conn:
        await conn.execute(
            "INSERT INTO team_members (team_id, user_id) VALUES (%s, %s) "
            "ON CONFLICT DO NOTHING",
            (team_id, user_id),
        )


async def delete_team_member(team_id: UUID, user_id: UUID) -> None:
    pool = await get_pool()
    async with pool.connection() as conn:
        await conn.execute(
            "DELETE FROM team_members WHERE team_id = %s AND user_id = %s",
            (team_id, user_id),
        )


async def get_team_members(team_id: UUID) -> list[dict]:
    pool = await get_pool()
    async with pool.connection() as conn:
        cur = await conn.execute(
            """
            SELECT u.id AS user_id, u.email, u.name
              FROM team_members tm
              JOIN users u ON u.id = tm.user_id
             WHERE tm.team_id = %s
             ORDER BY u.name
            """,
            (team_id,),
        )
        cur.row_factory = dict_row
        return await cur.fetchall()
