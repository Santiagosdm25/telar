"""
Fixtures de los tests de integración -- solo aplican a lo que está bajo
tests/integration/ (conftest.py es jerárquico: un autouse acá no toca
tests/test_compiler.py ni el resto de la suite, que sigue siendo lógica
pura sin Postgres).

Apunta el proceso de test a una base `telar_test` separada, en el mismo
Postgres que ya usás para desarrollar (docker compose up -d db) -- nada
de testcontainers ni infraestructura nueva.

Se fija DATABASE_URL acá, antes de que cualquier módulo de telar llame a
settings() por primera vez (está @lru_cache-eado).

IMPORTANTE (Windows): AsyncConnectionPool (telar.db.pool, usado por toda
la app) se cuelga al abrir en este host -- confirmado esta sesión, incluso
con el event loop correcto. Estos tests no corren con un `python -m
pytest` directo en Windows: se corren dentro del contenedor `api` (mismo
Linux donde ya corre producción), pasando DATABASE_URL/
TEST_DB_ADMIN_CONNINFO apuntando a "db" en vez de "localhost". Ver el
comentario de verificación en el plan de esta ronda para el comando
exacto. En Linux/Mac, correrlos directo en el host también debería andar
sin este rodeo.
"""

from __future__ import annotations

import asyncio
import os
import sys
from pathlib import Path

os.environ.setdefault("DATABASE_URL", "postgresql://telar:telar@localhost:5432/telar_test")
_ADMIN_CONNINFO = os.environ.get(
    "TEST_DB_ADMIN_CONNINFO", "postgresql://telar:telar@localhost:5432/telar"
)

# psycopg async se niega a correr sobre el ProactorEventLoop que asyncio usa
# por defecto en Windows -- necesita un Selector event loop. Tiene que
# fijarse acá, a nivel de módulo, antes de que pytest-asyncio cree el
# primer loop de la sesión -- hacerlo más tarde (ej. dentro de la fixture
# async de abajo) no sirve, porque para entonces el loop equivocado ya
# está corriendo. El único costo es una DeprecationWarning aunque estos
# tests estén excluidos (ver addopts) -- inofensiva, no abre nada.
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
    """
    Recrea telar_test desde cero al arrancar la sesión de tests, le aplica
    todas las migraciones reales (mismos archivos que usa producción), y
    cierra el pool al terminar. No se puede DROP/CREATE DATABASE estando
    conectado a la base que se está recreando -- se usa `telar` (que ya
    existe) como conexión administrativa aparte.
    """
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
    """Vacía las tablas que tocan los tests de integración antes de cada
    uno -- evita que se pisen entre sí sin recrear la base cada vez."""
    pool = await get_pool()
    async with pool.connection() as conn:
        await conn.execute(
            f"TRUNCATE {', '.join(_INTEGRATION_TABLES)} RESTART IDENTITY CASCADE"
        )
    yield
