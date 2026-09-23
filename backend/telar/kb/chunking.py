"""Fragmentación de texto para ingestar en una base de conocimiento."""

from __future__ import annotations

from langchain_text_splitters import RecursiveCharacterTextSplitter

_splitter = RecursiveCharacterTextSplitter(chunk_size=800, chunk_overlap=100)


def split_text(text: str) -> list[str]:
    return [chunk for chunk in _splitter.split_text(text) if chunk.strip()]
