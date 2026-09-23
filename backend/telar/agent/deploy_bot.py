"""
Bootstrap de un bot con flujo propio. v0 no tiene API de administración:
se define el grafo en un archivo JSON local y se despliega con este
script, igual que bases de conocimiento y tools configurables.

Formato del archivo (ver agent/compiler.py para el contrato completo):
    {
      "nodes": [{"id": "agente", "type": "agent", "system_prompt": "...", "tools": null}],
      "edges": [{"from": "START", "to": "agente"}, {"from": "agente", "to": "END"}]
    }

Uso:
    python -m telar.agent.deploy_bot <account_id> <nombre_del_bot> flow.json
"""

from __future__ import annotations

import argparse
import asyncio
import json
from pathlib import Path
from uuid import UUID

from telar.agent.compiler import GraphCompileError, compile_graph
from telar.agent.graph import TOOLS
from telar.custom_tools.loader import build_custom_tools
from telar.db import repositories as repo


async def deploy_bot(account_id: UUID, name: str, graph_json: dict) -> None:
    # Se compila de verdad, con las tools reales de la cuenta, antes de
    # guardar nada: si el JSON está mal, no queda un bot roto en la DB.
    extra_tools = await build_custom_tools(account_id)
    compile_graph(graph_json, available_tools=TOOLS + extra_tools)

    bot = await repo.get_bot_by_name(account_id, name)
    bot_id = bot["id"] if bot else await repo.insert_bot(account_id, name)

    version = await repo.get_next_bot_version(bot_id)
    version_id = await repo.insert_bot_version(bot_id, version, graph_json)
    await repo.set_active_bot_version(bot_id, version_id)

    print(f"Bot {bot_id} versión {version}, activa.")


def main() -> None:
    parser = argparse.ArgumentParser(description="Despliega un bot con flujo propio.")
    parser.add_argument("account_id", type=UUID)
    parser.add_argument("name")
    parser.add_argument("file", type=Path)
    args = parser.parse_args()

    graph_json = json.loads(args.file.read_text(encoding="utf-8"))
    try:
        asyncio.run(deploy_bot(args.account_id, args.name, graph_json))
    except GraphCompileError as e:
        raise SystemExit(f"Grafo inválido: {e}") from None


if __name__ == "__main__":
    main()
