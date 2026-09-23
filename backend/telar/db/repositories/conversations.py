"""Contactos, conversaciones, mensajes (incluido el buffer de durabilidad) y
plantillas de WhatsApp."""

from __future__ import annotations

import json
from datetime import datetime
from uuid import UUID

from psycopg.rows import dict_row

from telar.core.state import Conversation
from telar.core.types import (
    ContactRef,
    ConversationStatus,
    InboundMessage,
    OutboundMessage,
    SenderType,
)
from telar.db.pool import get_pool

__all__ = [
    "already_processed",
    "delete_buffered_messages",
    "delete_message_template",
    "get_buffered_messages",
    "get_contact",
    "get_contacts_for_account",
    "get_conversation",
    "get_conversation_stats",
    "get_conversations_for_account",
    "get_message",
    "get_message_template",
    "get_message_templates_for_account",
    "get_messages_for_conversation",
    "get_or_create_conversation",
    "insert_buffered_message",
    "insert_message_template",
    "list_buffered_keys",
    "save_conversation",
    "save_conversation_if_unchanged",
    "save_inbound",
    "save_inbound_rate_limited",
    "save_outbound",
    "update_message_delivery_status",
    "upsert_contact",
]


async def already_processed(inbox_id: UUID, channel_message_id: str) -> bool:
    """Deduplicación: Meta reintenta el webhook."""
    pool = await get_pool()
    async with pool.connection() as conn:
        cur = await conn.execute(
            "SELECT 1 FROM messages WHERE inbox_id = %s AND channel_message_id = %s",
            (inbox_id, channel_message_id),
        )
        return await cur.fetchone() is not None


async def insert_buffered_message(msg: InboundMessage) -> None:
    """ON CONFLICT DO NOTHING: Meta puede reintentar mientras el mensaje sigue en el buffer."""
    pool = await get_pool()
    async with pool.connection() as conn:
        await conn.execute(
            """
            INSERT INTO inbound_message_buffer
                (inbox_id, contact_external_id, channel_message_id, payload)
            VALUES (%s, %s, %s, %s)
            ON CONFLICT (inbox_id, channel_message_id) DO NOTHING
            """,
            (
                msg.inbox_id,
                msg.contact.external_id,
                msg.channel_message_id,
                json.dumps(msg.model_dump(mode="json")),
            ),
        )


async def get_buffered_messages(inbox_id: UUID, contact_external_id: str) -> list[dict]:
    pool = await get_pool()
    async with pool.connection() as conn:
        cur = await conn.execute(
            "SELECT id, payload FROM inbound_message_buffer "
            "WHERE inbox_id = %s AND contact_external_id = %s ORDER BY received_at",
            (inbox_id, contact_external_id),
        )
        cur.row_factory = dict_row
        return await cur.fetchall()


async def delete_buffered_messages(ids: list[UUID]) -> None:
    if not ids:
        return
    pool = await get_pool()
    async with pool.connection() as conn:
        await conn.execute(
            "DELETE FROM inbound_message_buffer WHERE id = ANY(%s)", (ids,)
        )


async def list_buffered_keys() -> list[dict]:
    pool = await get_pool()
    async with pool.connection() as conn:
        cur = await conn.execute(
            "SELECT DISTINCT inbox_id, contact_external_id FROM inbound_message_buffer"
        )
        cur.row_factory = dict_row
        return await cur.fetchall()


async def upsert_contact(account_id: UUID, contact: ContactRef) -> UUID:
    pool = await get_pool()
    async with pool.connection() as conn:
        cur = await conn.execute(
            """
            INSERT INTO contacts (account_id, external_id, name, phone)
            VALUES (%s, %s, %s, %s)
            ON CONFLICT (account_id, external_id) DO UPDATE
              SET name = COALESCE(EXCLUDED.name, contacts.name)
            RETURNING id
            """,
            (account_id, contact.external_id, contact.name, contact.phone),
        )
        row = await cur.fetchone()
    return row[0]


async def get_or_create_conversation(
    account_id: UUID,
    inbox_id: UUID,
    contact_id: UUID,
    default_team_id: UUID | None = None,
) -> Conversation:
    """El índice parcial one_live_conversation impide dos conversaciones vivas por contacto
    aunque lleguen webhooks simultáneos. `default_team_id` solo se usa al crear."""
    pool = await get_pool()
    async with pool.connection() as conn:
        cur = await conn.execute(
            """
            SELECT id, status, assignee_id, team_id,
                   last_contact_message_at, resolved_at
            FROM conversations
            WHERE inbox_id = %s AND contact_id = %s AND status <> 'resolved'
            """,
            (inbox_id, contact_id),
        )
        row = await cur.fetchone()

        if row is None:
            cur = await conn.execute(
                """
                INSERT INTO conversations
                    (account_id, inbox_id, contact_id, status, team_id)
                VALUES (%s, %s, %s, 'bot', %s)
                RETURNING id, status, assignee_id, team_id,
                          last_contact_message_at, resolved_at
                """,
                (account_id, inbox_id, contact_id, default_team_id),
            )
            row = await cur.fetchone()

    return Conversation(
        id=row[0],
        account_id=account_id,
        inbox_id=inbox_id,
        contact_id=contact_id,
        status=ConversationStatus(row[1]),
        assignee_id=row[2],
        team_id=row[3],
        last_contact_message_at=row[4],
        resolved_at=row[5],
    )


async def save_conversation(conv: Conversation) -> None:
    pool = await get_pool()
    async with pool.connection() as conn:
        await conn.execute(
            """
            UPDATE conversations
               SET status = %s, assignee_id = %s, team_id = %s,
                   last_contact_message_at = %s, resolved_at = %s
             WHERE id = %s
            """,
            (
                conv.status.value,
                conv.assignee_id,
                conv.team_id,
                conv.last_contact_message_at,
                conv.resolved_at,
                conv.id,
            ),
        )


async def save_conversation_if_unchanged(
    conv: Conversation, expected_status: ConversationStatus, expected_assignee_id: UUID | None
) -> bool:
    """Optimistic locking sobre el estado leído. False si alguien la cambió en el medio."""
    pool = await get_pool()
    async with pool.connection() as conn:
        cur = await conn.execute(
            """
            UPDATE conversations
               SET status = %s, assignee_id = %s, team_id = %s,
                   last_contact_message_at = %s, resolved_at = %s
             WHERE id = %s AND status = %s AND assignee_id IS NOT DISTINCT FROM %s
            """,
            (
                conv.status.value,
                conv.assignee_id,
                conv.team_id,
                conv.last_contact_message_at,
                conv.resolved_at,
                conv.id,
                expected_status.value,
                expected_assignee_id,
            ),
        )
    return cur.rowcount > 0


async def save_inbound(msg: InboundMessage, conversation_id: UUID) -> UUID | None:
    """Devuelve None si el mensaje ya estaba guardado (webhook repetido)."""
    pool = await get_pool()
    async with pool.connection() as conn:
        cur = await conn.execute(
            """
            INSERT INTO messages
                (account_id, conversation_id, inbox_id, channel_message_id,
                 sender_type, type, content, media, delivery_status)
            VALUES (%s, %s, %s, %s, 'contact', %s, %s, %s, 'delivered')
            ON CONFLICT DO NOTHING
            RETURNING id
            """,
            (
                msg.account_id,
                conversation_id,
                msg.inbox_id,
                msg.channel_message_id,
                msg.type.value,
                msg.as_agent_text(),
                msg.media.model_dump_json() if msg.media else None,
            ),
        )
        row = await cur.fetchone()
    return row[0] if row else None


async def save_inbound_rate_limited(msg: InboundMessage, conversation_id: UUID) -> UUID | None:
    """Guarda un mensaje descartado por el rate limiter, con delivery_status propio."""
    pool = await get_pool()
    async with pool.connection() as conn:
        cur = await conn.execute(
            """
            INSERT INTO messages
                (account_id, conversation_id, inbox_id, channel_message_id,
                 sender_type, type, content, media, delivery_status)
            VALUES (%s, %s, %s, %s, 'contact', %s, %s, %s, 'rate_limited')
            ON CONFLICT DO NOTHING
            RETURNING id
            """,
            (
                msg.account_id,
                conversation_id,
                msg.inbox_id,
                msg.channel_message_id,
                msg.type.value,
                msg.as_agent_text(),
                msg.media.model_dump_json() if msg.media else None,
            ),
        )
        row = await cur.fetchone()
    return row[0] if row else None


async def update_message_delivery_status(channel_message_id: str, status: str) -> None:
    """Aplica los estados sent/delivered/read/failed del webhook."""
    pool = await get_pool()
    async with pool.connection() as conn:
        await conn.execute(
            "UPDATE messages SET delivery_status = %s WHERE channel_message_id = %s",
            (status, channel_message_id),
        )


async def save_outbound(
    msg: OutboundMessage, account_id: UUID, inbox_id: UUID, channel_message_id: str | None
) -> UUID:
    pool = await get_pool()
    async with pool.connection() as conn:
        cur = await conn.execute(
            """
            INSERT INTO messages
                (account_id, conversation_id, inbox_id, channel_message_id,
                 sender_type, sender_id, type, content, delivery_status)
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s)
            RETURNING id
            """,
            (
                account_id,
                msg.conversation_id,
                inbox_id,
                channel_message_id,
                msg.sender_type.value if isinstance(msg.sender_type, SenderType) else msg.sender_type,
                msg.sender_id,
                msg.type.value,
                msg.text,
                "sent" if channel_message_id else "failed",
            ),
        )
        row = await cur.fetchone()
    return row[0]


async def get_conversation(conversation_id: UUID) -> Conversation | None:
    pool = await get_pool()
    async with pool.connection() as conn:
        cur = await conn.execute(
            """
            SELECT id, account_id, inbox_id, contact_id, status, assignee_id,
                   team_id, last_contact_message_at, resolved_at
              FROM conversations
             WHERE id = %s
            """,
            (conversation_id,),
        )
        row = await cur.fetchone()

    if row is None:
        return None

    return Conversation(
        id=row[0],
        account_id=row[1],
        inbox_id=row[2],
        contact_id=row[3],
        status=ConversationStatus(row[4]),
        assignee_id=row[5],
        team_id=row[6],
        last_contact_message_at=row[7],
        resolved_at=row[8],
    )


async def get_conversations_for_account(
    account_id: UUID,
    status: str | None = None,
    team_id: UUID | None = None,
    assignee_id: UUID | None = None,
    q: str | None = None,
    limit: int = 50,
    offset: int = 0,
) -> list[dict]:
    pool = await get_pool()
    async with pool.connection() as conn:
        cur = await conn.execute(
            """
            SELECT c.id, c.status, c.assignee_id, c.team_id, c.last_contact_message_at,
                   ct.id AS contact_id, ct.name AS contact_name, ct.phone AS contact_phone
              FROM conversations c
              JOIN contacts ct ON ct.id = c.contact_id
             WHERE c.account_id = %(account_id)s
               AND (%(status)s::text IS NULL OR c.status = %(status)s::conversation_status)
               AND (%(team_id)s::uuid IS NULL OR c.team_id = %(team_id)s::uuid)
               AND (%(assignee_id)s::uuid IS NULL OR c.assignee_id = %(assignee_id)s::uuid)
               AND (
                    %(q)s::text IS NULL
                    OR ct.name ILIKE '%%' || %(q)s || '%%'
                    OR ct.phone ILIKE '%%' || %(q)s || '%%'
               )
             ORDER BY c.last_contact_message_at DESC NULLS LAST
             LIMIT %(limit)s OFFSET %(offset)s
            """,
            {
                "account_id": account_id,
                "status": status,
                "team_id": team_id,
                "assignee_id": assignee_id,
                "q": q,
                "limit": limit,
                "offset": offset,
            },
        )
        cur.row_factory = dict_row
        return await cur.fetchall()


async def get_messages_for_conversation(
    conversation_id: UUID, limit: int = 50, before: datetime | None = None
) -> list[dict]:
    """Últimos N mensajes anteriores a `before`, en orden cronológico."""
    pool = await get_pool()
    async with pool.connection() as conn:
        cur = await conn.execute(
            """
            SELECT id, sender_type, sender_id, type, content, media, delivery_status, created_at
              FROM messages
             WHERE conversation_id = %(conversation_id)s
               AND (%(before)s::timestamptz IS NULL OR created_at < %(before)s::timestamptz)
             ORDER BY created_at DESC
             LIMIT %(limit)s
            """,
            {"conversation_id": conversation_id, "before": before, "limit": limit},
        )
        cur.row_factory = dict_row
        rows = await cur.fetchall()
    return list(reversed(rows))


async def get_message(message_id: UUID) -> dict | None:
    pool = await get_pool()
    async with pool.connection() as conn:
        cur = await conn.execute(
            "SELECT id, account_id, conversation_id, media FROM messages WHERE id = %s",
            (message_id,),
        )
        cur.row_factory = dict_row
        rows = await cur.fetchall()
    return rows[0] if rows else None


async def get_contacts_for_account(
    account_id: UUID, q: str | None = None, limit: int = 50, offset: int = 0
) -> list[dict]:
    pool = await get_pool()
    async with pool.connection() as conn:
        cur = await conn.execute(
            """
            SELECT id, external_id, name, phone, email, created_at
              FROM contacts
             WHERE account_id = %(account_id)s
               AND (
                    %(q)s::text IS NULL
                    OR name ILIKE '%%' || %(q)s || '%%'
                    OR phone ILIKE '%%' || %(q)s || '%%'
                    OR email ILIKE '%%' || %(q)s || '%%'
               )
             ORDER BY created_at DESC
             LIMIT %(limit)s OFFSET %(offset)s
            """,
            {"account_id": account_id, "q": q, "limit": limit, "offset": offset},
        )
        cur.row_factory = dict_row
        return await cur.fetchall()


async def get_contact(contact_id: UUID) -> dict | None:
    pool = await get_pool()
    async with pool.connection() as conn:
        cur = await conn.execute(
            "SELECT id, external_id, name, phone, email FROM contacts WHERE id = %s",
            (contact_id,),
        )
        cur.row_factory = dict_row
        rows = await cur.fetchall()
    return rows[0] if rows else None


async def get_conversation_stats(account_id: UUID) -> dict[str, int]:
    pool = await get_pool()
    async with pool.connection() as conn:
        cur = await conn.execute(
            "SELECT status, count(*) FROM conversations WHERE account_id = %s GROUP BY status",
            (account_id,),
        )
        rows = await cur.fetchall()

    counts = {status.value: 0 for status in ConversationStatus}
    for status_value, count in rows:
        counts[status_value] = count
    return counts


async def insert_message_template(
    account_id: UUID, name: str, language: str, components: list[dict]
) -> UUID:
    pool = await get_pool()
    async with pool.connection() as conn:
        cur = await conn.execute(
            """
            INSERT INTO message_templates (account_id, name, language, components)
            VALUES (%s, %s, %s, %s)
            RETURNING id
            """,
            (account_id, name, language, json.dumps(components)),
        )
        row = await cur.fetchone()
    return row[0]


async def get_message_templates_for_account(account_id: UUID) -> list[dict]:
    pool = await get_pool()
    async with pool.connection() as conn:
        cur = await conn.execute(
            "SELECT id, name, language, components, created_at FROM message_templates "
            "WHERE account_id = %s ORDER BY name",
            (account_id,),
        )
        cur.row_factory = dict_row
        return await cur.fetchall()


async def get_message_template(template_id: UUID) -> dict | None:
    pool = await get_pool()
    async with pool.connection() as conn:
        cur = await conn.execute(
            "SELECT id, account_id, name, language, components FROM message_templates "
            "WHERE id = %s",
            (template_id,),
        )
        cur.row_factory = dict_row
        rows = await cur.fetchall()
    return rows[0] if rows else None


async def delete_message_template(template_id: UUID) -> None:
    pool = await get_pool()
    async with pool.connection() as conn:
        await conn.execute("DELETE FROM message_templates WHERE id = %s", (template_id,))
