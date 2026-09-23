"""
Almacenamiento de los archivos de media (fotos, audios, documentos)
descargados de WhatsApp Cloud API.

v0: disco local, en el volumen de Docker configurado en `media_storage_dir`
-- mismo criterio que ya se usa para Postgres, sin sumar una dependencia de
infraestructura nueva para una instalación de una sola cuenta. Este es el
único módulo que sabe *dónde* vive el archivo; si en algún momento hace
falta S3/MinIO (por ejemplo, correr la API en más de una instancia a la
vez), se cambia acá y nada más del proyecto necesita saber la diferencia.

La clave de almacenamiento es el `external_id` que Meta le puso al archivo
(el `media.id` del webhook) -- ya es único y estable, no depende de en qué
orden se inserta el mensaje en la base.
"""

from __future__ import annotations

import asyncio
import re
from pathlib import Path

from telar.config import settings

_SAFE_ID = re.compile(r"[^A-Za-z0-9_.-]")


def _path_for(external_id: str) -> Path:
    # external_id viene de Meta, no del usuario, pero igual no confiamos en
    # que no tenga "/" o "..": normalizamos antes de tocar el filesystem.
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
