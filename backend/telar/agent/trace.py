"""
Traza de un turno del bot: qué agente actuó, qué herramienta llamó, qué
devolvió. La usa el chat de prueba para mostrar "qué pasó" en el lienzo.

Funciona con un ContextVar: quien quiere la traza abre `collect()` antes de
invocar el grafo, y los nodos registran eventos con `record()`. Fuera de un
`collect()` (en producción, el pipeline normal) `record()` no hace nada y no
cuesta nada. Las tareas de asyncio heredan el contexto al crearse, así que
los eventos de los nodos y de los sub-agentes llegan a la misma lista.
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
