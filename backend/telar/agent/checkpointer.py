"""
El checkpointer de Postgres (memoria del agente vía LangGraph) compartido
por todo el proceso -- antes vivía como atributo privado de Pipeline
(worker/pipeline.py); se saca a un módulo aparte para que el chat de
prueba (agent/router.py) use exactamente el mismo, en vez de abrir un
segundo AsyncPostgresSaver contra el mismo pool.
"""

from __future__ import annotations

from langgraph.checkpoint.postgres.aio import AsyncPostgresSaver

from telar.db.pool import get_pool

_checkpointer: AsyncPostgresSaver | None = None


async def get_checkpointer() -> AsyncPostgresSaver:
    global _checkpointer
    if _checkpointer is None:
        pool = await get_pool()
        _checkpointer = AsyncPostgresSaver(pool)
        await _checkpointer.setup()
    return _checkpointer
