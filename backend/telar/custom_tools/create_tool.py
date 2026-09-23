"""Crea una tool configurable desde un JSON local.

    python -m telar.custom_tools.create_tool <account_id> tool.json

    {
        "name": "consultar_pedido",
        "description": "Busca el estado de un pedido por su numero.",
        "kind": "http",
        "config": {"url": "https://api.miempresa.com/pedidos", "method": "GET"},
        "secret": {"headers": {"Authorization": "Bearer ..."}},
        "schema": {
            "properties": {"order_id": {"type": "string", "description": "numero de pedido"}},
            "required": ["order_id"]
        }
    }

El archivo lleva el secreto en texto plano: borralo después.
"""

from __future__ import annotations

import argparse
import asyncio
import json
from pathlib import Path
from uuid import UUID

from telar.custom_tools.service import ToolValidationError
from telar.custom_tools.service import create_tool as _create_tool


async def create_tool(account_id: UUID, definition: dict) -> None:
    try:
        tool_id = await _create_tool(
            account_id,
            definition["name"],
            definition["description"],
            definition["kind"],
            definition["config"],
            definition.get("secret"),
            definition.get("schema", {}),
        )
    except ToolValidationError as e:
        raise SystemExit(f"Definición rechazada: {e}") from None
    print(f"Tool creada: {tool_id}")


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Crea una tool configurable (http/sql). Preferí el endpoint "
        "HTTP POST /accounts/{account_id}/tools si ya tenés login -- este "
        "script es para instalaciones sin API de administración levantada."
    )
    parser.add_argument("account_id", type=UUID)
    parser.add_argument("file", type=Path)
    args = parser.parse_args()

    definition = json.loads(args.file.read_text(encoding="utf-8"))
    asyncio.run(create_tool(args.account_id, definition))
    print("Recordá borrar el archivo: tiene un secreto en texto plano.")


if __name__ == "__main__":
    main()
