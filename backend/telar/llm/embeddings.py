"""Embeddings para bases de conocimiento. Solo OpenAI: el esquema fija vector(1536).

langchain_openai se importa adentro para no exigir telar[openai] al importar el módulo.
"""

from __future__ import annotations

from functools import lru_cache
from typing import Any


@lru_cache(maxsize=8)
def get_embeddings(model: str = "text-embedding-3-small") -> Any:
    from langchain_openai import OpenAIEmbeddings

    return OpenAIEmbeddings(model=model)
