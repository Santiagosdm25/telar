"""Tool SQL de solo lectura contra la base Postgres externa de la cuenta.

La protección real es la conexión read-only (Postgres la hace cumplir); el chequeo
de prefijo SELECT/WITH es solo una barrera rápida.
"""

from __future__ import annotations

import logging
import re
from typing import Any

import psycopg
from langchain_core.tools import StructuredTool
from psycopg.rows import dict_row

from telar.custom_tools.schema import build_args_model

log = logging.getLogger(__name__)

_MAX_ROWS = 20
_READONLY_PREFIX = re.compile(r"^\s*(select|with)\b", re.IGNORECASE)
_POSTGRES_SCHEMES = {"postgres", "postgresql"}


class UnsafeQueryError(Exception):
    pass


class UnsupportedEngineError(Exception):
    pass


def check_query_is_readonly(query: str) -> None:
    if not _READONLY_PREFIX.match(query):
        raise UnsafeQueryError("la query debe empezar con SELECT o WITH")


def check_connection_is_postgres(connection_string: str) -> None:
    """psycopg solo entiende Postgres: se rechaza otro motor al guardar, con un error claro."""
    scheme = connection_string.split("://", 1)[0].lower() if "://" in connection_string else ""
    if scheme not in _POSTGRES_SCHEMES:
        raise UnsupportedEngineError(
            "la connection_string debe ser de Postgres (postgres:// o "
            "postgresql://) -- esta tool no soporta otros motores"
        )


def build_sql_tool(row: dict[str, Any], secret: dict[str, Any]) -> StructuredTool:
    query = row["config"]["query"]
    connection_string = secret["connection_string"]

    check_query_is_readonly(query)

    args_model = build_args_model(row["schema"], model_name=f"{row['name']}_args")

    async def _run(**kwargs: Any) -> str:
        # ToolNode no atrapa excepciones arbitrarias: una base caída tumbaría el turno.
        try:
            check_query_is_readonly(query)

            conn = await psycopg.AsyncConnection.connect(
                connection_string, autocommit=False, connect_timeout=10
            )
            try:
                await conn.set_read_only(True)
                async with conn.cursor(row_factory=dict_row) as cur:
                    await cur.execute(query, kwargs)
                    rows = await cur.fetchmany(_MAX_ROWS)
            finally:
                await conn.rollback()
                await conn.close()
        except UnsafeQueryError as e:
            log.error("tool %s: query no permitida (%s)", row["name"], e)
            return "Esta herramienta está mal configurada y no se puede usar."
        except Exception:
            log.exception("tool %s: fallo consultando la base externa", row["name"])
            return "No se pudo consultar la herramienta externa en este momento."

        if not rows:
            return "Sin resultados."
        return str(rows)

    return StructuredTool.from_function(
        coroutine=_run,
        name=row["name"],
        description=row["description"],
        args_schema=args_model,
    )
