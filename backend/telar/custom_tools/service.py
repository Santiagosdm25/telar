"""
Lógica compartida para crear/editar tools configurables (http/sql).

Usada tanto por el CLI (create_tool.py, que hoy es la única forma de
correrlo a mano) como por el router HTTP de administración
(custom_tools/router.py) -- para no repetir la validación de seguridad en
dos lugares que puedan desincronizarse.
"""

from __future__ import annotations

from uuid import UUID

from telar.agent import graph_cache
from telar.custom_tools.http_tool import UnsafeURLError, check_url_is_safe
from telar.custom_tools.secrets import encrypt_secret
from telar.custom_tools.sql_tool import (
    UnsafeQueryError,
    UnsupportedEngineError,
    check_connection_is_postgres,
    check_query_is_readonly,
)
from telar.db import repositories as repo


class ToolValidationError(Exception):
    pass


# Un documento entero vive en config.text (jsonb) -- generoso para "un
# documento de referencia", pero documentos más grandes que esto deberían
# ir a una base de conocimiento (ingesta + búsqueda semántica) en vez de
# acá, donde la "búsqueda" es un substring plano.
_DOCUMENT_MAX_CHARS = 300_000


def validate_tool_config(kind: str, config: dict, secret: dict | None = None) -> None:
    """
    Se corre antes de guardar, para no dejar creada una tool que nunca va a
    poder ejecutarse (o que sea insegura desde el vamos). No relaja las
    restricciones deliberadas de http_tool.py/sql_tool.py: esto valida la
    forma de la config, la seguridad real se revisa de nuevo en cada
    llamada de la tool ya construida.

    `secret` solo se valida cuando viene: en una edición, `None` significa
    "no tocar el secreto guardado" (ver service.update_tool), y ese ya
    pasó esta misma validación cuando se guardó.
    """
    try:
        if kind == "http":
            check_url_is_safe(config["url"])
        elif kind == "sql":
            check_query_is_readonly(config["query"])
            if secret is not None:
                check_connection_is_postgres(secret["connection_string"])
        elif kind == "document":
            text = config.get("text")
            if not isinstance(text, str) or not text.strip():
                raise ToolValidationError("falta la clave 'text' en config (no puede estar vacía)")
            if len(text) > _DOCUMENT_MAX_CHARS:
                raise ToolValidationError(
                    f"el documento supera los {_DOCUMENT_MAX_CHARS:,} caracteres -- "
                    "para algo así de grande usá una base de conocimiento en vez de esta tool"
                )
        else:
            raise ToolValidationError(
                f"kind no soportado: {kind!r} (usar 'http', 'sql' o 'document')"
            )
    except (UnsafeURLError, UnsafeQueryError, UnsupportedEngineError) as e:
        raise ToolValidationError(str(e)) from None
    except KeyError as e:
        raise ToolValidationError(f"falta la clave {e} en config o secret") from None


async def create_tool(
    account_id: UUID,
    name: str,
    description: str,
    kind: str,
    config: dict,
    secret: dict | None,
    schema: dict,
) -> UUID:
    validate_tool_config(kind, config, secret)
    tool_id = await repo.insert_tool(
        account_id, name, description, kind, config, encrypt_secret(secret), schema
    )
    await graph_cache.invalidate(account_id)
    return tool_id


async def update_tool(
    account_id: UUID,
    tool_id: UUID,
    name: str,
    description: str,
    kind: str,
    config: dict,
    schema: dict,
    enabled: bool,
    secret: dict | None = None,
) -> None:
    """`secret=None` deja el secreto existente intacto (rotarlo es explícito)."""
    validate_tool_config(kind, config, secret)
    await repo.update_tool(tool_id, name, description, config, schema, enabled)
    if secret is not None:
        await repo.update_tool_secret(tool_id, encrypt_secret(secret))
    await graph_cache.invalidate(account_id)


async def delete_tool(account_id: UUID, tool_id: UUID) -> None:
    await repo.delete_tool(tool_id)
    await graph_cache.invalidate(account_id)
