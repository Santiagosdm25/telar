"""Pipeline: de un lote de mensajes entrantes a una respuesta enviada."""

from __future__ import annotations

import asyncio
import logging

from langchain_core.messages import HumanMessage

from telar.agent import graph_cache
from telar.agent.checkpointer import get_checkpointer
from telar.agent.compiler import message_text, tool_called_this_turn
from telar.agent.tools import escalar_a_humano
from telar.channels.meta import MetaWhatsAppAdapter, resolve_inbox_credentials
from telar.config import settings
from telar.core import state as st
from telar.core.types import InboundMessage, OutboundMessage, SenderType
from telar.db import repositories as repo

log = logging.getLogger(__name__)


class Pipeline:
    def __init__(self, adapter: MetaWhatsAppAdapter) -> None:
        self.adapter = adapter
        # Tope global de invocaciones concurrentes al LLM.
        self._semaphore = asyncio.Semaphore(
            settings().rate_limit_max_concurrent_agent_calls
        )

    async def _get_graph(self, account_id):
        checkpointer = await get_checkpointer()
        return await graph_cache.get_or_build(account_id, checkpointer)

    async def handle_rate_limited(self, msg: InboundMessage) -> None:
        """Persiste el mensaje (visible en la bandeja) sin tocar el estado ni invocar el grafo."""
        contact_id = await repo.upsert_contact(msg.account_id, msg.contact)
        default_team_id = await repo.get_inbox_default_team(msg.inbox_id)
        conv = await repo.get_or_create_conversation(
            msg.account_id, msg.inbox_id, contact_id, default_team_id=default_team_id,
        )
        await repo.save_inbound_rate_limited(msg, conv.id)

    async def handle(self, batch: list[InboundMessage]) -> None:
        first = batch[0]

        contact_id = await repo.upsert_contact(first.account_id, first.contact)
        default_team_id = await repo.get_inbox_default_team(first.inbox_id)
        conv = await repo.get_or_create_conversation(
            first.account_id,
            first.inbox_id,
            contact_id,
            default_team_id=default_team_id,
        )

        # El dispatcher agrupa por contacto+inbox: un solo lookup por lote.
        phone_number_id, access_token = await resolve_inbox_credentials(first.inbox_id)

        # None si ya estaba guardado (reintento de Meta): solo los nuevos entran al turno.
        new_messages = []
        for msg in batch:
            if msg.media and msg.media.external_id:
                try:
                    msg.media = await self.adapter.download_media(
                        msg.media, access_token=access_token
                    )
                except Exception:
                    # Un fallo de descarga no debe perder el mensaje.
                    log.exception("no se pudo descargar el media de %s", msg.channel_message_id)
            inserted_id = await repo.save_inbound(msg, conv.id)
            if msg.channel_message_id:
                await self.adapter.mark_read(
                    msg.channel_message_id,
                    phone_number_id=phone_number_id,
                    access_token=access_token,
                )
            if inserted_id is not None:
                new_messages.append(msg)

        st.on_inbound(conv)
        await repo.save_conversation(conv)

        # Un humano tiene la conversación: no se genera respuesta.
        if not st.should_bot_reply(conv):
            log.info("conversación %s en estado %s, el bot no responde",
                     conv.id, conv.status.value)
            return

        if not new_messages:
            log.info("conversación %s: lote ya procesado (reintento de Meta)", conv.id)
            return

        text = "\n".join(m.as_agent_text() for m in new_messages)
        graph = await self._get_graph(conv.account_id)

        async with self._semaphore:
            result = await graph.ainvoke(
                {
                    "messages": [HumanMessage(content=text)],
                    "system_prompt": settings().default_system_prompt,
                    "account_id": str(conv.account_id),
                },
                config={"configurable": {"thread_id": str(conv.id)}},
            )

        answer = message_text(result["messages"][-1])

        if answer.strip():
            await self._send(conv, first, answer, phone_number_id, access_token)

        # Se detecta el handoff por el ToolMessage, no por el texto de la respuesta.
        if tool_called_this_turn(result["messages"], escalar_a_humano.name):
            st.request_handoff(conv, team_id=conv.team_id)
            await repo.save_conversation(conv)
            log.info("conversación %s transferida a humano", conv.id)

    async def _send(
        self,
        conv,
        inbound: InboundMessage,
        text: str,
        phone_number_id: str,
        access_token: str,
    ) -> None:
        if not st.window_is_open(conv):
            log.warning("ventana de 24h cerrada en %s: se requiere plantilla", conv.id)
            st.request_handoff(conv, team_id=conv.team_id)
            await repo.save_conversation(conv)
            return

        out = OutboundMessage(
            conversation_id=conv.id, sender_type=SenderType.BOT, text=text
        )
        result = await self.adapter.send(
            out, inbound.contact, phone_number_id=phone_number_id, access_token=access_token
        )
        await repo.save_outbound(
            out, inbound.account_id, inbound.inbox_id, result.channel_message_id
        )
        if not result.ok:
            log.error("no se pudo enviar: %s %s", result.error_code, result.error_message)
