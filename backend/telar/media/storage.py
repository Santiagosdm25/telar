"""Almacenamiento en disco local de la media descargada de WhatsApp, indexada por `external_id`."""

from __future__ import annotations

import asyncio
import re
from pathlib import Path

from telar.config import settings

_SAFE_ID = re.compile(r"[^A-Za-z0-9_.-]")


def _path_for(external_id: str) -> Path:
    # Se normaliza aunque venga de Meta: nada de "/" o ".." en la ruta.
    safe = _SAFE_ID.sub("_", external_id)
    return Path(settings().media_storage_dir) / safe


def _write(path: Path, content: bytes) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(content)


def _read(path: Path) -> bytes | None:
    if not path.is_file():
        return None
    return path.read_bytes()


async def save(external_id: str, content: bytes) -> None:
    await asyncio.to_thread(_write, _path_for(external_id), content)


async def read(external_id: str) -> bytes | None:
    return await asyncio.to_thread(_read, _path_for(external_id))
