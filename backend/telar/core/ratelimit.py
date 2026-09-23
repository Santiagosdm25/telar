"""Rate limit por ventana fija en Postgres, compartido entre réplicas.

Ventana fija para que el chequeo sea un único INSERT ... ON CONFLICT atómico; en el
borde entre ventanas puede dejar pasar hasta ~2x el límite.
"""

from __future__ import annotations

import time

from telar.db.pool import get_pool


async def allow(key: str, max_events: int, window_seconds: float) -> bool:
    pool = await get_pool()
    window_start = int(time.time() // window_seconds * window_seconds)
    async with pool.connection() as conn:
        cur = await conn.execute(
            """
            INSERT INTO rate_limit_counters (key, window_start, count)
            VALUES (%s, to_timestamp(%s), 1)
            ON CONFLICT (key, window_start)
              DO UPDATE SET count = rate_limit_counters.count + 1
            RETURNING count
            """,
            (key, window_start),
        )
        row = await cur.fetchone()
    return row[0] <= max_events
