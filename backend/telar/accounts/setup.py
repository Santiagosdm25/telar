"""Estado de arranque de una cuenta: qué falta para que el bot conteste."""

from __future__ import annotations

from typing import Any, Literal

NextStep = Literal["inbox", "llm", "prompt", "done"]


def graph_has_custom_prompt(graph: dict[str, Any] | None) -> bool:
    if not graph:
        return False
    for node in graph.get("nodes") or []:
        prompt = node.get("system_prompt")
        if isinstance(prompt, str) and prompt.strip():
            return True
    return False


def next_setup_step(
    *,
    has_inbox: bool,
    has_active_llm: bool,
    has_custom_prompt: bool,
) -> NextStep:
    if not has_inbox:
        return "inbox"
    if not has_active_llm:
        return "llm"
    if not has_custom_prompt:
        return "prompt"
    return "done"
