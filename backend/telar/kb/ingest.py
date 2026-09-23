"""
Ingesta de un archivo de texto a una base de conocimiento.

v0 no tiene API ni UI de administración: la base de conocimiento se crea a
mano con INSERT (igual que cuenta e inbox, ver README) y este script llena
kb_chunks a partir de un archivo.

Uso:
    python -m telar.kb.ingest <knowledge_base_id> <archivo> [--source nombre]
"""

from __future__ import annotations

import argparse
import asyncio
from pathlib import Path
from uuid import UUID

from telar.db import repositories as repo
from telar.kb.chunking import split_text
from telar.llm.embeddings import get_embeddings


async def ingest_text(knowledge_base_id: UUID, text: str, source: str | None = None) -> int:
    """
    El fragmentado + embeddings + insert que antes solo corría desde el CLI
    -- extraído para que el endpoint HTTP de ingesta (kb/router.py) use
    exactamente la misma lógica en vez de duplicarla.
    """
    chunks = split_text(text)
    if not chunks:
        return 0

    embeddings = get_embeddings()
    vectors = await embeddings.aembed_documents(chunks)

    rows = [(source, chunk, vector) for chunk, vector in zip(chunks, vectors)]
    await repo.insert_kb_chunks(knowledge_base_id, rows)
    return len(rows)


async def ingest_file(
    knowledge_base_id: UUID, path: Path, source: str | None = None
) -> int:
    text = path.read_text(encoding="utf-8")
    return await ingest_text(knowledge_base_id, text, source or path.name)


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Ingesta un archivo de texto a una base de conocimiento."
    )
    parser.add_argument("knowledge_base_id", type=UUID)
    parser.add_argument("file", type=Path)
    parser.add_argument("--source", default=None)
    args = parser.parse_args()

    count = asyncio.run(ingest_file(args.knowledge_base_id, args.file, args.source))
    print(f"{count} fragmentos insertados.")


if __name__ == "__main__":
    main()
