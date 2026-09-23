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
            max_size=10,
            open=False,
            kwargs={"autocommit": True},
        )
        await _pool.open(wait=True)
    return _pool


async def close_pool() -> None:
    global _pool
    if _pool is not None:
        await _pool.close()
        _pool = None
