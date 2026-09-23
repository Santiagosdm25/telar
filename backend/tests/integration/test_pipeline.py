"""
Tests de integración del camino completo: webhook -> dispatcher ->
pipeline -> agente -> envío, contra una Postgres real (ver conftest.py en
este mismo directorio).

El LLM y el envío a Meta se simulan (no hay credenciales reales en test);
todo lo demás -- firma del webhook, parseo, buffer durable, debounce,
resolución de contacto/conversación, guardado de mensajes -- corre tal
cual corre en producción.

Marcados `integration` y excluidos por defecto (ver `addopts` en
pyproject.toml) -- un `pytest -q` común sigue siendo rápido y sin
depender de Postgres. Para correrlos: `pytest -m integration` (dentro del
contenedor `api` en Windows, ver conftest.py).
"""

from __future__ import annotations

import asyncio
import hashlib
import hmac
import json
import time
from datetime import datetime, timezone
from uuid import uuid4

import httpx
import pytest
from langchain_core.messages import AIMessage

import telar.agent.compiler as compiler_mod
import telar.api.main as api_main
from telar.config import settings
from telar.core.types import Channel, ContactRef, InboundMessage, MessageType, SendResult
from telar.db import repositories as repo
from telar.db.pool import get_pool
from telar.worker.dispatcher import Dispatcher

pytestmark = pytest.mark.integration


class _FakeReplyModel:
    """Respuesta fija -- estos tests no necesitan simular tool-calling
    (para eso ya está test_compiler.py), solo que el turno se complete."""

    REPLY = "Gracias por escribir, ya te ayudamos."

    def bind_tools(self, tools):
        return self

    async def ainvoke(self, messages):
        return AIMessage(content=self.REPLY)


@pytest.fixture
async def seeded_account(monkeypatch):
    """Cuenta + inbox de prueba, con UUIDs nuevos por test para no chocar
    con el caché de grafo (agent/graph_cache.py, por account_id)."""
    account_id = uuid4()
    inbox_id = uuid4()
    phone_number_id = f"phone-{uuid4().hex[:8]}"

    pool = await get_pool()
    async with pool.connection() as conn:
        await conn.execute(
            "INSERT INTO accounts (id, name) VALUES (%s, %s)", (account_id, "Cuenta de test")
        )
        await conn.execute(
            """
            INSERT INTO inboxes (id, account_id, name, phone_number_id)
            VALUES (%s, %s, %s, %s)
            """,
            (inbox_id, account_id, "Inbox de test", phone_number_id),
        )

    # Modelo y envío simulados -- se revierten solos al terminar el test.
    monkeypatch.setattr(compiler_mod, "get_model", lambda *a, **k: _FakeReplyModel())
    sent_messages: list[dict] = []

    async def fake_send(message, to, *, phone_number_id=None, access_token=None):
        sent_messages.append({"text": message.text, "to": to.external_id})
        return SendResult(ok=True, channel_message_id=f"wamid.fake_{uuid4().hex[:8]}")

    monkeypatch.setattr(api_main.pipeline.adapter, "send", fake_send)
    monkeypatch.setattr(api_main.dispatcher, "_debounce", 0.05)

    return account_id, inbox_id, phone_number_id, sent_messages


def _make_webhook_payload(phone_number_id: str, wa_id: str, text: str, channel_message_id: str) -> bytes:
    payload = {
        "entry": [
            {
                "changes": [
                    {
                        "value": {
                            "metadata": {"phone_number_id": phone_number_id},
                            "contacts": [{"wa_id": wa_id, "profile": {"name": "Cliente de test"}}],
                            "messages": [
                                {
                                    "id": channel_message_id,
                                    "from": wa_id,
                                    "timestamp": str(int(time.time())),
                                    "type": "text",
                                    "text": {"body": text},
                                }
                            ],
                        }
                    }
                ]
            }
        ]
    }
    return json.dumps(payload).encode()


def _sign(body: bytes) -> str:
    digest = hmac.new(settings().meta_app_secret.encode(), body, hashlib.sha256).hexdigest()
    return f"sha256={digest}"


async def _wait_until_buffer_empty(inbox_id, contact_external_id: str, timeout: float = 3.0) -> None:
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        rows = await repo.get_buffered_messages(inbox_id, contact_external_id)
        if not rows:
            return
        await asyncio.sleep(0.05)
    raise AssertionError("el buffer no se vació a tiempo -- el mensaje nunca terminó de procesarse")


async def _assert_conversation_processed(inbox_id, wa_id: str, expected_text: str, expected_reply: str) -> None:
    pool = await get_pool()
    async with pool.connection() as conn:
        cur = await conn.execute(
            """
            SELECT m.sender_type, m.content
              FROM messages m
              JOIN conversations c ON c.id = m.conversation_id
              JOIN contacts ct ON ct.id = c.contact_id
             WHERE ct.external_id = %s AND c.inbox_id = %s
             ORDER BY m.created_at
            """,
            (wa_id, inbox_id),
        )
        rows = await cur.fetchall()

    senders_and_content = [(r[0], r[1]) for r in rows]
    assert ("contact", expected_text) in senders_and_content
    assert ("bot", expected_reply) in senders_and_content


async def test_webhook_to_reply_end_to_end(seeded_account):
    account_id, inbox_id, phone_number_id, sent_messages = seeded_account
    wa_id = f"549{uuid4().int % 10**10}"
    text = "hola, necesito ayuda con mi pedido"
    channel_message_id = f"wamid.{uuid4().hex}"

    body = _make_webhook_payload(phone_number_id, wa_id, text, channel_message_id)
    signature = _sign(body)

    transport = httpx.ASGITransport(app=api_main.app)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
        resp = await client.post(
            "/webhooks/whatsapp",
            content=body,
            headers={"Content-Type": "application/json", "X-Hub-Signature-256": signature},
        )

    assert resp.status_code == 200
    assert resp.json() == {"status": "ok"}

    await _wait_until_buffer_empty(inbox_id, wa_id)
    await _assert_conversation_processed(inbox_id, wa_id, text, _FakeReplyModel.REPLY)

    assert len(sent_messages) == 1
    assert sent_messages[0]["text"] == _FakeReplyModel.REPLY


async def test_recover_pending_processes_orphaned_buffer(seeded_account):
    """
    Simula exactamente el escenario que la Etapa 1 resolvió: un mensaje
    que quedó en inbound_message_buffer porque el proceso anterior murió
    antes de procesarlo. recover_pending() (llamado al arrancar un
    proceso nuevo) tiene que retomarlo solo.
    """
    account_id, inbox_id, phone_number_id, sent_messages = seeded_account
    wa_id = f"549{uuid4().int % 10**10}"
    text = "este mensaje quedo huerfano de un crash anterior"
    channel_message_id = f"wamid.{uuid4().hex}"

    msg = InboundMessage(
        channel_message_id=channel_message_id,
        account_id=account_id,
        inbox_id=inbox_id,
        channel=Channel.WHATSAPP,
        contact=ContactRef(external_id=wa_id, name="Cliente huérfano", phone=f"+{wa_id}"),
        type=MessageType.TEXT,
        text=text,
        sent_at=datetime.now(timezone.utc),
    )
    # Igual que hace dispatcher.submit() antes del debounce -- pero sin
    # pasar por el dispatcher, para simular que el proceso murió justo
    # después de persistir y nunca llegó a programar/completar el timer.
    await repo.insert_buffered_message(msg)

    # "Proceso nuevo": Dispatcher fresco, sin nada en memoria.
    fresh_dispatcher = Dispatcher(api_main.pipeline.handle, debounce=0.05)
    await fresh_dispatcher.recover_pending()

    await _wait_until_buffer_empty(inbox_id, wa_id)
    await _assert_conversation_processed(inbox_id, wa_id, text, _FakeReplyModel.REPLY)
    assert len(sent_messages) == 1
