"""Bases de conocimiento y sus chunks vectorizados (pgvector)."""

from __future__ import annotations

from uuid import UUID

from psycopg.rows import dict_row

from telar.db.pool import get_pool

__all__ = [
    "insert_kb_chunks",
    "search_kb_chunks",
    "insert_knowledge_base",
    "get_knowledge_bases_for_account",
    "get_knowledge_base",
    "delete_knowledge_base",
]


def _to_vector_literal(embedding: list[float]) -> str:
    """
    psycopg no trae adaptador para el tipo vector de pgvector: se serializa
    a texto y se castea en la query con ::vector. repr() de un float en
    Python siempre usa punto decimal, sin importar el locale del sistema.
    """
    return "[" + ",".join(repr(x) for x in embedding) + "]"


async def insert_kb_chunks(
    knowledge_base_id: UUID, rows: list[tuple[str | None, str, list[float]]]
) -> None:
    """rows: (source, content, embedding)."""
    pool = await get_pool()
    async with pool.connection() as conn:
        async with conn.cursor() as cur:
            await cur.executemany(
                """
                INSERT INTO kb_chunks (knowledge_base_id, source, content, embedding)
                VALUES (%s, %s, %s, %s::vector)
                """,
                [
                    (knowledge_base_id, source, content, _to_vector_literal(embedding))
                    for source, content, embedding in rows
                ],
            )


async def search_kb_chunks(
    account_id: UUID, embedding: list[float], limit: int = 5
) -> list[dict]:
    """
    Similitud coseno contra kb_chunks de todas las bases de conocimiento de
    la cuenta, usando el índice hnsw (kb_chunks_vec) de la migración.
    """
    vec = _to_vector_literal(embedding)
    pool = await get_pool()
    async with pool.connection() as conn:
        cur = await conn.execute(
            """
            SELECT kc.content, kc.source,
                   1 - (kc.embedding <=> %(vec)s::vector) AS similarity
              FROM kb_chunks kc
              JOIN knowledge_bases kb ON kb.id = kc.knowledge_base_id
             WHERE kb.account_id = %(account_id)s
             ORDER BY kc.embedding <=> %(vec)s::vector
             LIMIT %(limit)s
            """,
            {"vec": vec, "account_id": account_id, "limit": limit},
        )
        cur.row_factory = dict_row
        return await cur.fetchall()


async def insert_knowledge_base(account_id: UUID, name: str) -> UUID:
    pool = await get_pool()
    async with pool.connection() as conn:
        cur = await conn.execute(
            "INSERT INTO knowledge_bases (account_id, name) VALUES (%s, %s) RETURNING id",
            (account_id, name),
        )
        row = await cur.fetchone()
    return row[0]


async def get_knowledge_bases_for_account(account_id: UUID) -> list[dict]:
    pool = await get_pool()
    async with pool.connection() as conn:
        cur = await conn.execute(
            "SELECT id, name, embedding_model, dimensions FROM knowledge_bases "
            "WHERE account_id = %s ORDER BY name",
            (account_id,),
        )
        cur.row_factory = dict_row
        return await cur.fetchall()


async def get_knowledge_base(knowledge_base_id: UUID) -> dict | None:
    pool = await get_pool()
    async with pool.connection() as conn:
        cur = await conn.execute(
            "SELECT id, account_id, name, embedding_model, dimensions "
            "FROM knowledge_bases WHERE id = %s",
            (knowledge_base_id,),
        )
        cur.row_factory = dict_row
        rows = await cur.fetchall()
    return rows[0] if rows else None


async def delete_knowledge_base(knowledge_base_id: UUID) -> None:
    """kb_chunks se borra en cascada (ON DELETE CASCADE en la migración)."""
    pool = await get_pool()
    async with pool.connection() as conn:
        await conn.execute("DELETE FROM knowledge_bases WHERE id = %s", (knowledge_base_id,))
