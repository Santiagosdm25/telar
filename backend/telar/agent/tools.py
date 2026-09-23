"""
Herramientas del agente.
"""

from __future__ import annotations

import logging
from typing import Annotated
from uuid import UUID

from langchain_core.tools import tool
from langgraph.prebuilt import InjectedState

from telar.db import repositories as repo
from telar.llm.embeddings import get_embeddings

log = logging.getLogger(__name__)


@tool
def escalar_a_humano(motivo: str) -> str:
    """
    Transfiere la conversación a un asesor humano.

    Úsala cuando el cliente lo pida explícitamente, cuando esté molesto, o
    cuando el caso exceda lo que puedes resolver. No la uses para preguntas
    que puedes contestar tú.

    Args:
        motivo: por qué se transfiere, en una frase, para el asesor.
    """
    # El efecto real lo aplica el worker al ver esta llamada; la tool solo
    # devuelve el texto que el modelo dirá antes de soltar la conversación.
    return "TRANSFERIR: " + motivo


@tool
async def consultar_base_de_conocimiento(
    pregunta: str,
    account_id: Annotated[str, InjectedState("account_id")],
) -> str:
    """
    Busca información en la base de conocimiento de la cuenta.

    Úsala cuando el cliente pregunte algo que podría estar documentado
    (precios, políticas, productos) y no lo sepas con certeza. No la uses
    para saludos o small talk.

    Args:
        pregunta: qué buscar, en pocas palabras clave.
    """
    # ToolNode no convierte excepciones arbitrarias en un ToolMessage de
    # error: por default solo lo hace para ToolInvocationError, cualquier
    # otra cosa (sin OPENAI_API_KEY, OpenAI caído, la base de datos) se
    # propaga y tumba el turno completo del agente. Como esto cruza un
    # límite externo (proveedor de embeddings + base de datos), se atrapa
    # acá para que un fallo de KB no se lleve puesta toda la respuesta.
    try:
        embeddings = get_embeddings()
        vector = await embeddings.aembed_query(pregunta)
        chunks = await repo.search_kb_chunks(UUID(account_id), vector)
    except Exception:
        log.exception("fallo consultando la base de conocimiento")
        return "No se pudo consultar la base de conocimiento en este momento."

    if not chunks:
        return "No se encontró información relevante en la base de conocimiento."

    return "\n\n".join(f"[{c['source'] or 'kb'}] {c['content']}" for c in chunks)
