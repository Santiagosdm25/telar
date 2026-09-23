"""Conexión a la base de datos externa de la cuenta (tenant_db)."""

from __future__ import annotations

from uuid import UUID

from psycopg.rows import dict_row

from telar.db.pool import get_pool

__all__ = [
    "get_account_database_connection",
    "get_account_database_credentials",
    "upsert_account_database_connection",
    "set_database_connection_status",
    "mark_database_provisioned",
    "delete_account_database_connection",
]


async def get_account_database_connection(account_id: UUID) -> dict | None:
    """Nunca incluye password: es de solo escritura hacia el cliente."""
    pool = await get_pool()
    async with pool.connection() as conn:
        cur = await conn.execute(
            "SELECT account_id, engine, host, port, database_name, username, use_ssl, "
            "status, last_error, provisioned_at, created_at, updated_at "
            "FROM account_database_connections WHERE account_id = %s",
            (account_id,),
        )
        cur.row_factory = dict_row
        rows = await cur.fetchall()
    return rows[0] if rows else None


async def get_account_database_credentials(account_id: UUID) -> dict | None:
    """La única función que sí devuelve la password (cifrada) -- para
    probar/aprovisionar contra la conexión ya guardada."""
    pool = await get_pool()
    async with pool.connection() as conn:
        cur = await conn.execute(
            "SELECT engine, host, port, database_name, username, password, use_ssl "
            "FROM account_database_connections WHERE account_id = %s",
            (account_id,),
        )
        cur.row_factory = dict_row
        rows = await cur.fetchall()
    return rows[0] if rows else None


async def upsert_account_database_connection(
    account_id: UUID,
    engine: str,
    host: str,
    port: int,
    database_name: str,
    username: str,
    password: bytes,
    use_ssl: bool,
) -> None:
    pool = await get_pool()
    async with pool.connection() as conn:
        await conn.execute(
            """
            INSERT INTO account_database_connections
                (account_id, engine, host, port, database_name, username, password, use_ssl,
                 status, last_error, provisioned_at, updated_at)
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s, 'disconnected', NULL, NULL, now())
            ON CONFLICT (account_id) DO UPDATE SET
                engine = excluded.engine,
                host = excluded.host,
                port = excluded.port,
                database_name = excluded.database_name,
                username = excluded.username,
                password = excluded.password,
                use_ssl = excluded.use_ssl,
                status = 'disconnected',
                last_error = NULL,
                provisioned_at = NULL,
                updated_at = now()
            """,
            (account_id, engine, host, port, database_name, username, password, use_ssl),
        )


async def set_database_connection_status(
    account_id: UUID, status: str, last_error: str | None
) -> None:
    pool = await get_pool()
    async with pool.connection() as conn:
        await conn.execute(
            "UPDATE account_database_connections "
            "SET status = %s, last_error = %s, updated_at = now() WHERE account_id = %s",
            (status, last_error, account_id),
        )


async def mark_database_provisioned(account_id: UUID) -> None:
    pool = await get_pool()
    async with pool.connection() as conn:
        await conn.execute(
            "UPDATE account_database_connections "
            "SET status = 'provisioned', last_error = NULL, provisioned_at = now(), "
            "updated_at = now() WHERE account_id = %s",
            (account_id,),
        )


async def delete_account_database_connection(account_id: UUID) -> None:
    """Solo olvida la conexión guardada -- nunca toca ni borra nada en la
    base externa del cliente."""
    pool = await get_pool()
    async with pool.connection() as conn:
        await conn.execute(
            "DELETE FROM account_database_connections WHERE account_id = %s", (account_id,)
        )
