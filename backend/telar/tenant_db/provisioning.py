"""Prueba de conexión y aprovisionamiento de tablas en la base externa de la cuenta.

Síncrono en un hilo: no está en el camino caliente. MySQL requiere el extra "mysql".
"""

from __future__ import annotations

import asyncio
import logging
import uuid
from typing import Literal

from telar.tenant_db.schema import CREATE_STATEMENTS, DEFAULT_ROLES

log = logging.getLogger(__name__)

Engine = Literal["postgres", "mysql"]


class TenantDbError(Exception):
    """Fallo de conexión o de aprovisionamiento contra la base del cliente."""


def _seed_default_roles(cur) -> None:
    cur.execute("SELECT name FROM telar_roles")
    existing = {row[0] for row in cur.fetchall()}
    for name in DEFAULT_ROLES:
        if name not in existing:
            cur.execute(
                "INSERT INTO telar_roles (id, name) VALUES (%s, %s)",
                (str(uuid.uuid4()), name),
            )


def _pg_connect(host: str, port: int, database: str, username: str, password: str, use_ssl: bool):
    import psycopg
    from psycopg.conninfo import make_conninfo

    # make_conninfo escapa los valores: un f-string permitiría inyectar parámetros libpq
    # (p. ej. sslmode) desde la password.
    conninfo = make_conninfo(
        host=host,
        port=port,
        dbname=database,
        user=username,
        password=password,
        sslmode="require" if use_ssl else "prefer",
        connect_timeout=10,
    )
    return psycopg.connect(conninfo, autocommit=True)


def _mysql_connect(host: str, port: int, database: str, username: str, password: str, use_ssl: bool):
    try:
        import pymysql
    except ImportError as e:
        raise TenantDbError(
            "El backend no tiene soporte de MySQL instalado (falta pymysql; "
            'instalá el extra "mysql": pip install "telar[mysql]").'
        ) from e

    return pymysql.connect(
        host=host,
        port=port,
        database=database,
        user=username,
        password=password,
        connect_timeout=10,
        ssl={"ssl": {}} if use_ssl else None,
        autocommit=True,
    )


def _connect(engine: Engine, **kwargs):
    return _pg_connect(**kwargs) if engine == "postgres" else _mysql_connect(**kwargs)


def _test_sync(engine: Engine, **kwargs) -> None:
    conn = _connect(engine, **kwargs)
    try:
        with conn.cursor() as cur:
            cur.execute("SELECT 1")
    finally:
        conn.close()


def _provision_sync(engine: Engine, **kwargs) -> None:
    suffix = " ENGINE=InnoDB" if engine == "mysql" else ""
    conn = _connect(engine, **kwargs)
    try:
        with conn.cursor() as cur:
            for statement in CREATE_STATEMENTS:
                cur.execute(statement.format(suffix=suffix))
            _seed_default_roles(cur)
    finally:
        conn.close()


async def test_connection(
    engine: Engine, host: str, port: int, database: str, username: str, password: str, use_ssl: bool
) -> None:
    """Solo confirma que se puede conectar y correr una query."""
    try:
        await asyncio.to_thread(
            _test_sync,
            engine=engine,
            host=host,
            port=port,
            database=database,
            username=username,
            password=password,
            use_ssl=use_ssl,
        )
    except TenantDbError:
        raise
    except Exception as e:
        log.warning("prueba de conexión falló (%s): %s", engine, e)
        raise TenantDbError(str(e)) from e


async def provision(
    engine: Engine, host: str, port: int, database: str, username: str, password: str, use_ssl: bool
) -> None:
    """Crea las tablas si no existen; es idempotente."""
    try:
        await asyncio.to_thread(
            _provision_sync,
            engine=engine,
            host=host,
            port=port,
            database=database,
            username=username,
            password=password,
            use_ssl=use_ssl,
        )
    except TenantDbError:
        raise
    except Exception as e:
        log.error("aprovisionamiento falló (%s): %s", engine, e)
        raise TenantDbError(str(e)) from e
