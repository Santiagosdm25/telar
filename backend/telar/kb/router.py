"""
Administración de bases de conocimiento por HTTP -- la contraparte de crear
la fila a mano e ingestar con `python -m telar.kb.ingest`. El embedding
sigue fijo (text-embedding-3-small / vector(1536), ver README); esto solo
saca el CLI/INSERT manual del camino.
"""

from __future__ import annotations

from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, UploadFile, status
from pydantic import BaseModel

from telar.auth.dependencies import Membership, require_role
from telar.auth.roles import AccountRole
from telar.db import repositories as repo
from telar.kb.ingest import ingest_text

router = APIRouter(prefix="/accounts/{account_id}/knowledge-bases", tags=["knowledge-bases"])


class CreateKnowledgeBaseRequest(BaseModel):
    name: str


class KnowledgeBaseResponse(BaseModel):
    id: UUID
    name: str
    embedding_model: str
    dimensions: int


class IngestResponse(BaseModel):
    chunks_inserted: int


async def _get_kb_or_404(account_id: UUID, knowledge_base_id: UUID) -> dict:
    kb = await repo.get_knowledge_base(knowledge_base_id)
    if kb is None or kb["account_id"] != account_id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Base de conocimiento no encontrada")
    return kb


@router.get("", response_model=list[KnowledgeBaseResponse])
async def list_knowledge_bases(
    account_id: UUID, membership: Membership = Depends(require_role(AccountRole.ADMINISTRATOR))
) -> list[KnowledgeBaseResponse]:
    rows = await repo.get_knowledge_bases_for_account(account_id)
    return [KnowledgeBaseResponse(**row) for row in rows]


@router.post("", response_model=KnowledgeBaseResponse)
async def create_knowledge_base(
    account_id: UUID,
    body: CreateKnowledgeBaseRequest,
    membership: Membership = Depends(require_role(AccountRole.ADMINISTRATOR)),
) -> KnowledgeBaseResponse:
    kb_id = await repo.insert_knowledge_base(account_id, body.name)
    return KnowledgeBaseResponse(
        id=kb_id, name=body.name, embedding_model="text-embedding-3-small", dimensions=1536
    )


@router.delete("/{knowledge_base_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_knowledge_base(
    account_id: UUID,
    knowledge_base_id: UUID,
    membership: Membership = Depends(require_role(AccountRole.ADMINISTRATOR)),
) -> None:
    await _get_kb_or_404(account_id, knowledge_base_id)
    await repo.delete_knowledge_base(knowledge_base_id)


@router.post("/{knowledge_base_id}/ingest", response_model=IngestResponse)
async def ingest_document(
    account_id: UUID,
    knowledge_base_id: UUID,
    file: UploadFile,
    membership: Membership = Depends(require_role(AccountRole.ADMINISTRATOR)),
) -> IngestResponse:
    await _get_kb_or_404(account_id, knowledge_base_id)

    raw = await file.read()
    try:
        text = raw.decode("utf-8")
    except UnicodeDecodeError as e:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_ENTITY, "El archivo debe ser texto plano UTF-8"
        ) from e

    count = await ingest_text(knowledge_base_id, text, source=file.filename)
    return IngestResponse(chunks_inserted=count)
