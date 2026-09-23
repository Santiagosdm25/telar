"""
Embeddings para búsqueda semántica en bases de conocimiento.

v0 solo soporta OpenAI: es lo único que coincide con las dimensiones fijas
del esquema (kb_chunks.embedding es vector(1536), igual que
text-embedding-3-small). El import de langchain_openai va adentro de la
función para que el módulo se pueda importar sin telar[openai] instalado;
el error solo aparece si de verdad se llama la tool de KB.
"""

from __future__ import annotations

from functools import lru_cache
from typing import Any


@lru_cache(maxsize=8)
def get_embeddings(model: str = "text-embedding-3-small") -> Any:
    from langchain_openai import OpenAIEmbeddings

    return OpenAIEmbeddings(model=model)
