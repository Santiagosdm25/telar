"""Fixtures de integración: usan una base `telar_test` en el Postgres de desarrollo.

DATABASE_URL se fija antes del primer settings() (está cacheado). En Windows,
AsyncConnectionPool se cuelga en el host: correr estos tests dentro del contenedor `api`.
"""

from __future__ import annotations

import asyncio
import os
import sys
from pathlib import Path

os.environ.setdefault("DATABASE_URL", "postgresql://telar:telar@localhost:5432/telar_test")
# Sin secreto el adapter rechaza todo webhook.
os.environ.setdefault("META_APP_SECRET", "test-app-secret")
_ADMIN_CONNINFO = os.environ.get(
    "TEST_DB_ADMIN_CONNINFO", "postgresql://telar:telar@localhost:5432/telar"
)

# psycopg async no corre sobre el ProactorEventLoop de Windows; hay que fijar
# la política antes de que pytest-asyncio cree el primer loop.
if sys.platform == "win32":
    asyncio.set_event_loop_policy(asyncio.WindowsSelectorEventLoopPolicy())

import psycopg
import pytest

from telar.db.pool import close_pool, get_pool

_MIGRATIONS_DIR = Path(__file__).resolve().parents[2] / "migrations"

_INTEGRATION_TABLES = (
    "inbound_message_buffer",
    "messages",
    "conversations",
    "contacts",
    "inboxes",
    "account_graph_versions",
    "rate_limit_counters",
    "accounts",
)


@pytest.fixture(scope="session", autouse=True)
async def test_db():
    """Recrea telar_test con las migraciones reales (vía la base `telar` como admin)."""
    admin_conn = await psycopg.AsyncConnection.connect(_ADMIN_CONNINFO, autocommit=True)
    try:
        await admin_conn.execute("DROP DATABASE IF EXISTS telar_test WITH (FORCE)")
        await admin_conn.execute("CREATE DATABASE telar_test")
    finally:
        await admin_conn.close()

    test_conn = await psycopg.AsyncConnection.connect(
        os.environ["DATABASE_URL"], autocommit=True
    )
    try:
        for migration in sorted(_MIGRATIONS_DIR.glob("*.sql")):
            sql = migration.read_text(encoding="utf-8")
            await test_conn.execute(sql)
    finally:
        await test_conn.close()

    yield

    await close_pool()


@pytest.fixture(autouse=True)
async def clean_db(test_db):
    """Vacía las tablas de integración antes de cada test."""
    pool = await get_pool()
    async with pool.connection() as conn:
        await conn.execute(
            f"TRUNCATE {', '.join(_INTEGRATION_TABLES)} RESTART IDENTITY CASCADE"
        )
    yield
