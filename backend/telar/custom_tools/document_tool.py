"""Tool "document": un texto plano con búsqueda por substring, sin embeddings."""

from __future__ import annotations

from typing import Any

from langchain_core.tools import StructuredTool
from pydantic import BaseModel, Field

_DEFAULT_MAX_CHARS = 6000
_CONTEXT_BEFORE = 400


class DocumentArgs(BaseModel):
    busqueda: str | None = Field(
        None,
        description=(
            "Palabra o frase a buscar dentro del documento (opcional). Sin esto, "
            "devuelve desde el principio del documento."
        ),
    )


def build_document_tool(row: dict[str, Any], secret: dict[str, Any]) -> StructuredTool:
    del secret
    config = row["config"]
    text: str = config.get("text") or ""
    max_chars = int(config.get("max_chars") or _DEFAULT_MAX_CHARS)

    async def _run(busqueda: str | None = None) -> str:
        if not text:
            return "Este documento todavía no tiene contenido cargado."

        if busqueda:
            idx = text.lower().find(busqueda.lower())
            if idx == -1:
                return (
                    f"No se encontró {busqueda!r} en el documento. "
                    "Probá con otra palabra, o sin búsqueda para ver el principio."
                )
            start = max(0, idx - _CONTEXT_BEFORE)
            end = min(len(text), start + max_chars)
            prefix = "(…)\n" if start > 0 else ""
            suffix = "\n(…)" if end < len(text) else ""
            return f"{prefix}{text[start:end]}{suffix}"

        if len(text) <= max_chars:
            return text
        return f"{text[:max_chars]}\n(…documento truncado, usá 'busqueda' para ver otra parte…)"

    return StructuredTool.from_function(
        coroutine=_run,
        name=row["name"],
        description=row["description"],
        args_schema=DocumentArgs,
    )
