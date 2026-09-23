"""
Frontera asíncrona entre el webhook y el agente.

El buffer de debounce vive en Postgres (inbound_message_buffer), no en
memoria: submit() persiste el mensaje ANTES de que el webhook devuelva 200
a Meta, así que un crash del proceso entre esa respuesta y que el lote
termine de procesarse no pierde nada -- lo que haya quedado sin procesar
se retoma al arrancar de nuevo (ver recover_pending()). El temporizador de
debounce en sí (asyncio, en memoria) sí se pierde en un reinicio, pero eso
solo corta la ventana de espera antes de tiempo, nunca el contenido.
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
        """
        Persiste el mensaje antes de volver -- el handler del webhook
        espera este await antes de responder 200 a Meta. El resto (esperar
        el debounce, procesar) sigue en segundo plano.
        """
        key = self._key(msg)

        # Anti-abuso: un contacto que manda mensajes en bucle no debe poder
        # disparar llamadas ilimitadas al LLM ni llenar el buffer. Contador
        # compartido en Postgres (core/ratelimit.py) -- correcto sin
        # importar cuántos procesos/réplicas lo compartan.
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
        """
        La gente manda varios mensajes seguidos, así que reiniciamos el
        temporizador en cada uno y el agente ve la ráfaga completa como un
        solo turno.
        """
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

        # El lock garantiza orden por contacto: dos ráfagas seguidas no se
        # procesan en paralelo y no se cruzan las respuestas.
        async with self._locks[key]:
            self._timers.pop(key, None)
            rows = await repo.get_buffered_messages(inbox_id, contact_external_id)
            if not rows:
                return
            batch = [InboundMessage.model_validate(r["payload"]) for r in rows]
            try:
                await self._handler(batch)
            except Exception:
                # No se borra el buffer: el próximo submit() de este
                # contacto (o el barrido de arranque, si el proceso muere
                # acá) lo vuelve a intentar.
                log.exception("fallo procesando lote de %s, se reintenta", key)
                return
            await repo.delete_buffered_messages([r["id"] for r in rows])

    async def recover_pending(self) -> None:
        """
        Se llama una vez al arrancar: retoma lo que un proceso anterior
        dejó sin procesar en el buffer (crash, reinicio, OOM kill).
        """
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
