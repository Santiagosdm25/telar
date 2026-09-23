"""Usuarios y su contraseña -- sin nada de cuentas/roles, ver accounts.py."""

from __future__ import annotations

from uuid import UUID

from psycopg.rows import dict_row

from telar.db.pool import get_pool

__all__ = [
    "get_user_by_email",
    "get_user_by_id",
    "get_user_accounts",
    "insert_user",
    "update_user_password",
]


async def get_user_by_email(email: str) -> dict | None:
    pool = await get_pool()
    async with pool.connection() as conn:
        cur = await conn.execute(
            "SELECT id, email, name, password_hash, is_superadmin "
            "FROM users WHERE email = %s",
            (email,),
        )
        cur.row_factory = dict_row
        rows = await cur.fetchall()
    return rows[0] if rows else None


async def get_user_by_id(user_id: UUID) -> dict | None:
    pool = await get_pool()
    async with pool.connection() as conn:
        cur = await conn.execute(
            "SELECT id, email, name, password_hash, is_superadmin "
            "FROM users WHERE id = %s",
            (user_id,),
        )
        cur.row_factory = dict_row
        rows = await cur.fetchall()
    return rows[0] if rows else None


async def get_user_accounts(user_id: UUID) -> list[dict]:
    pool = await get_pool()
    async with pool.connection() as conn:
        cur = await conn.execute(
            "SELECT account_id, role FROM account_users WHERE user_id = %s",
            (user_id,),
        )
        cur.row_factory = dict_row
        return await cur.fetchall()


async def insert_user(
    email: str, name: str, password_hash: str, is_superadmin: bool = False
) -> UUID:
    pool = await get_pool()
    async with pool.connection() as conn:
        cur = await conn.execute(
            """
            INSERT INTO users (email, name, password_hash, is_superadmin)
            VALUES (%s, %s, %s, %s)
            RETURNING id
            """,
            (email, name, password_hash, is_superadmin),
        )
        row = await cur.fetchone()
    return row[0]


async def update_user_password(user_id: UUID, password_hash: str) -> None:
    pool = await get_pool()
    async with pool.connection() as conn:
        await conn.execute(
            "UPDATE users SET password_hash = %s WHERE id = %s", (password_hash, user_id)
        )
