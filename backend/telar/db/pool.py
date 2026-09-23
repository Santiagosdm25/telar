"""Pool de conexiones. Una sola Postgres para estado, checkpoints y vectores."""

from __future__ import annotations

from psycopg_pool import AsyncConnectionPool

from telar.config import settings

_pool: AsyncConnectionPool | None = None


async def get_pool() -> AsyncConnectionPool:
    global _pool
    if _pool is None:
        _pool = AsyncConnectionPool(
            conninfo=settings().database_url,
            min_size=1,
            max_size=settings().db_pool_max_size,
            open=False,
            # Sin prepared statements: se rompen detrás de un pooler en modo transacción
            # (PgBouncer, Supabase :6543).
            kwargs={"autocommit": True, "prepare_threshold": None},
        )
        await _pool.open(wait=True)
    return _pool


async def close_pool() -> None:
    global _pool
    if _pool is not None:
        await _pool.close()
        _pool = None
