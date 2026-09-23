"""Frontera asíncrona entre el webhook y el agente.

El buffer de debounce vive en Postgres para que un crash no pierda mensajes ya
confirmados a Meta; recover_pending() retoma lo pendiente al arrancar.
"""

from __future__ import annotations

import asyncio
import logging
from collections import defaultdict
from uuid import UUID

from telar.config import settings
from telar.core import ratelimit
from telar.core.types import InboundMessage
from telar.db import repositories as repo

log = logging.getLogger(__name__)


class Dispatcher:
    def __init__(
        self, handler, debounce: float | None = None, on_rate_limited=None
    ) -> None:
        self._handler = handler
        self._debounce = debounce if debounce is not None else settings().debounce_seconds
        self._on_rate_limited = on_rate_limited
        self._timers: dict[str, asyncio.Task] = {}
        self._locks: dict[str, asyncio.Lock] = defaultdict(asyncio.Lock)

    async def submit(self, msg: InboundMessage) -> None:
        """Persiste el mensaje antes de volver: el webhook espera esto antes de responder 200."""
        key = self._key(msg)

        # Rate limit por contacto, compartido en Postgres entre réplicas.
        allowed = await ratelimit.allow(
            f"msg:{key}",
            settings().rate_limit_messages_per_window,
            settings().rate_limit_window_seconds,
        )
        if not allowed:
            log.warning("limite de mensajes excedido para %s, se descarta", key)
            if self._on_rate_limited:
                await self._on_rate_limited(msg)
            return

        await repo.insert_buffered_message(msg)
        self._schedule(key, msg.inbox_id, msg.contact.external_id, delay=self._debounce)

    def _schedule(
        self, key: str, inbox_id: UUID, contact_external_id: str, delay: float
    ) -> None:
        """Debounce: cada mensaje reinicia el temporizador y la ráfaga llega como un solo turno."""
        timer = self._timers.get(key)
        if timer and not timer.done():
            timer.cancel()
        self._timers[key] = asyncio.create_task(
            self._wait_and_run(key, inbox_id, contact_external_id, delay)
        )

    async def _wait_and_run(
        self, key: str, inbox_id: UUID, contact_external_id: str, delay: float
    ) -> None:
        if delay > 0:
            try:
                await asyncio.sleep(delay)
            except asyncio.CancelledError:
                return

        # Orden por contacto: dos ráfagas seguidas no se procesan en paralelo.
        async with self._locks[key]:
            self._timers.pop(key, None)
            rows = await repo.get_buffered_messages(inbox_id, contact_external_id)
            if not rows:
                return
            batch = [InboundMessage.model_validate(r["payload"]) for r in rows]
            try:
                await self._handler(batch)
            except Exception:
                # El buffer queda: el próximo submit() o el barrido de arranque lo reintenta.
                log.exception("fallo procesando lote de %s, se reintenta", key)
                return
            await repo.delete_buffered_messages([r["id"] for r in rows])

    async def recover_pending(self) -> None:
        """Retoma lo que un proceso anterior dejó en el buffer."""
        keys = await repo.list_buffered_keys()
        for row in keys:
            inbox_id, contact_external_id = row["inbox_id"], row["contact_external_id"]
            key = f"{inbox_id}:{contact_external_id}"
            log.info("recuperando mensajes pendientes de %s", key)
            self._schedule(key, inbox_id, contact_external_id, delay=0)

    @staticmethod
    def _key(msg: InboundMessage) -> str:
        return f"{msg.inbox_id}:{msg.contact.external_id}"

    async def drain(self) -> None:
        """Para el apagado ordenado: espera lo que quede en vuelo."""
        pending = [t for t in self._timers.values() if not t.done()]
        if pending:
            await asyncio.gather(*pending, return_exceptions=True)
