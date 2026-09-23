"""Traza de un turno (agentes, herramientas, resultados) para el chat de prueba.

Vive en un ContextVar: fuera de `collect()`, `record()` no hace nada. Las tareas de
asyncio heredan el contexto, así que los sub-agentes registran en la misma lista.
"""

from __future__ import annotations

from collections.abc import Iterator
from contextlib import contextmanager
from contextvars import ContextVar
from typing import Any

_MAX_TEXT = 600

_current: ContextVar[list[dict[str, Any]] | None] = ContextVar("telar_trace", default=None)


@contextmanager
def collect() -> Iterator[list[dict[str, Any]]]:
    events: list[dict[str, Any]] = []
    token = _current.set(events)
    try:
        yield events
    finally:
        _current.reset(token)


def enabled() -> bool:
    return _current.get() is not None


def record(**event: Any) -> None:
    events = _current.get()
    if events is not None:
        events.append(event)


def clip(value: Any) -> str:
    text = value if isinstance(value, str) else str(value)
    return text if len(text) <= _MAX_TEXT else text[:_MAX_TEXT] + "…"
