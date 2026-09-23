"""
Limitador de tasa por ventana fija, respaldado en Postgres -- compartido
entre todos los procesos/réplicas (a diferencia de una versión en memoria,
que cada proceso llevaría por separado). Se usa tanto para el volumen de
mensajes por contacto de WhatsApp (worker/dispatcher.py) como para los
intentos de login (auth/router.py).

Ventana fija, no deslizante exacta: todos los eventos de la misma ventana
de `window_seconds` cuentan juntos, calculada como
floor(time.time() / window_seconds) * window_seconds. En el borde entre
dos ventanas consecutivas se puede permitir hasta ~2x el límite por un
instante -- trade-off aceptado a propósito porque es lo que permite que
el chequeo sea una sola sentencia SQL atómica (INSERT ... ON CONFLICT),
sin necesitar ningún lock explícito entre leer y escribir. Para anti-abuso
(no un límite de facturación) es una aproximación estándar y suficiente.
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
