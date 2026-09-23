"""
Arma las tools configurables (http, sql, document) de una cuenta como
BaseTool de LangChain, listas para sumarse a TOOLS antes de bind_tools().
"""

from __future__ import annotations

import logging
from uuid import UUID

from langchain_core.tools import BaseTool

from telar.custom_tools.document_tool import build_document_tool
from telar.custom_tools.http_tool import build_http_tool
from telar.custom_tools.secrets import decrypt_secret
from telar.custom_tools.sql_tool import build_sql_tool
from telar.db import repositories as repo

log = logging.getLogger(__name__)

_BUILDERS = {
    "http": build_http_tool,
    "sql": build_sql_tool,
    "document": build_document_tool,
}


async def build_custom_tools(account_id: UUID) -> list[BaseTool]:
    rows = await repo.get_tools_for_account(account_id)
    tools: list[BaseTool] = []

    for row in rows:
        builder = _BUILDERS.get(row["kind"])
        if builder is None:
            continue  # kb/handoff son las tools fijas, no configurables

        try:
            secret = decrypt_secret(row.get("secret_config"))
            tools.append(builder(row, secret))
        except Exception:
            log.exception(
                "no se pudo armar la tool %s (cuenta %s), se omite",
                row.get("name"), account_id,
            )

    return tools
