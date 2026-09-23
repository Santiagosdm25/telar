"""Proveedores LLM configurables por cuenta."""

from __future__ import annotations

from uuid import UUID

from psycopg.rows import dict_row

from telar.db.pool import get_pool

__all__ = [
    "insert_llm_provider",
    "list_llm_providers",
    "get_llm_provider",
    "get_active_llm_provider",
    "update_llm_provider",
    "update_llm_provider_secret",
    "delete_llm_provider",
    "set_active_llm_provider",
]


async def insert_llm_provider(
    account_id: UUID,
    name: str,
    provider: str,
    model: str,
    base_url: str | None,
    api_key: bytes | None,
) -> UUID:
    pool = await get_pool()
    async with pool.connection() as conn:
        cur = await conn.execute(
            """
            INSERT INTO llm_providers (account_id, name, provider, model, base_url, api_key)
            VALUES (%s, %s, %s, %s, %s, %s)
            RETURNING id
            """,
            (account_id, name, provider, model, base_url, api_key),
        )
        row = await cur.fetchone()
    return row[0]


async def list_llm_providers(account_id: UUID) -> list[dict]:
    """Nunca incluye api_key: es de solo escritura hacia el cliente."""
    pool = await get_pool()
    async with pool.connection() as conn:
        cur = await conn.execute(
            "SELECT id, name, provider, model, base_url, is_active "
            "FROM llm_providers WHERE account_id = %s ORDER BY name",
            (account_id,),
        )
        cur.row_factory = dict_row
        return await cur.fetchall()


async def get_llm_provider(provider_id: UUID) -> dict | None:
    pool = await get_pool()
    async with pool.connection() as conn:
        cur = await conn.execute(
            "SELECT id, account_id, name, provider, model, base_url, is_active "
            "FROM llm_providers WHERE id = %s",
            (provider_id,),
        )
        cur.row_factory = dict_row
        rows = await cur.fetchall()
    return rows[0] if rows else None


async def get_active_llm_provider(account_id: UUID) -> dict | None:
    pool = await get_pool()
    async with pool.connection() as conn:
        cur = await conn.execute(
            "SELECT provider, model, base_url, api_key FROM llm_providers "
            "WHERE account_id = %s AND is_active = true",
            (account_id,),
        )
        cur.row_factory = dict_row
        rows = await cur.fetchall()
    return rows[0] if rows else None


async def update_llm_provider(
    provider_id: UUID, name: str, model: str, base_url: str | None
) -> None:
    pool = await get_pool()
    async with pool.connection() as conn:
        await conn.execute(
            "UPDATE llm_providers SET name = %s, model = %s, base_url = %s WHERE id = %s",
            (name, model, base_url, provider_id),
        )


async def update_llm_provider_secret(provider_id: UUID, api_key: bytes) -> None:
    pool = await get_pool()
    async with pool.connection() as conn:
        await conn.execute(
            "UPDATE llm_providers SET api_key = %s WHERE id = %s", (api_key, provider_id)
        )


async def delete_llm_provider(provider_id: UUID) -> None:
    pool = await get_pool()
    async with pool.connection() as conn:
        await conn.execute("DELETE FROM llm_providers WHERE id = %s", (provider_id,))


async def set_active_llm_provider(account_id: UUID, provider_id: UUID) -> None:
    """Desactiva el proveedor activo anterior (si hay) y activa el nuevo, en
    una sola transacción -- así nunca hay un instante con dos activos, cosa
    que además rompería el índice único parcial."""
    pool = await get_pool()
    async with pool.connection() as conn:
        async with conn.transaction():
            await conn.execute(
                "UPDATE llm_providers SET is_active = false "
                "WHERE account_id = %s AND is_active = true",
                (account_id,),
            )
            await conn.execute(
                "UPDATE llm_providers SET is_active = true WHERE id = %s", (provider_id,)
            )
