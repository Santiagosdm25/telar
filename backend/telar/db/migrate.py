"""
Aplica las migraciones de `migrations/` que falten, en orden, y lleva el
registro en `schema_migrations`. Reemplaza a `docker-entrypoint-initdb.d`,
que solo corre cuando el volumen de Postgres está vacío: con eso, una
migración nueva nunca llegaba a una base existente (ni a Supabase, que no
tiene initdb).

Uso:
    python -m telar.db.migrate              # aplica las pendientes
    python -m telar.db.migrate --status     # lista aplicadas y pendientes
    python -m telar.db.migrate --baseline   # marca todas como aplicadas sin
                                            # correrlas (bases creadas antes de
                                            # que existiera este script)

Cada archivo corre en su propia transacción: si falla, no queda a medias y
no se registra. Un advisory lock evita que dos réplicas migren a la vez.
"""

from __future__ import annotations

import argparse
import os
import sys
from pathlib import Path

import psycopg

from telar.config import settings

# backend/migrations en desarrollo, /app/migrations en la imagen.
MIGRATIONS_DIR = Path(
    os.environ.get("MIGRATIONS_DIR", Path(__file__).resolve().parents[2] / "migrations")
)

# Número arbitrario pero fijo: identifica "el lock de migraciones de Telar".
_LOCK_ID = 7_431_901

_CREATE_TABLE = """
CREATE TABLE IF NOT EXISTS schema_migrations (
    version     text PRIMARY KEY,
    applied_at  timestamptz NOT NULL DEFAULT now()
)
"""


def migration_files() -> list[Path]:
    files = sorted(MIGRATIONS_DIR.glob("*.sql"))
    if not files:
        raise SystemExit(f"No hay migraciones en {MIGRATIONS_DIR}")
    return files


def _applied(conn: psycopg.Connection) -> set[str]:
    return {row[0] for row in conn.execute("SELECT version FROM schema_migrations")}


def _schema_predates_runner(conn: psycopg.Connection) -> bool:
    """La base ya tiene el esquema de Telar pero nunca pasó por este script."""
    row = conn.execute(
        "SELECT to_regclass('public.accounts') IS NOT NULL, "
        "(SELECT count(*) FROM schema_migrations)"
    ).fetchone()
    assert row is not None
    has_schema, registered = row
    return bool(has_schema) and registered == 0


def run(*, baseline: bool = False, status: bool = False) -> None:
    files = migration_files()
    # Conexión propia, sin el pool de la app: esto corre antes de que la API
    # arranque, y el DDL no debe mezclarse con conexiones en autocommit.
    with psycopg.connect(settings().database_url, prepare_threshold=None) as conn:
        conn.autocommit = True
        conn.execute("SELECT pg_advisory_lock(%s)", (_LOCK_ID,))
        try:
            conn.execute(_CREATE_TABLE)
            applied = _applied(conn)
            pending = [f for f in files if f.name not in applied]

            if status:
                for f in files:
                    print(f"  {'aplicada ' if f.name in applied else 'PENDIENTE'}  {f.name}")
                return

            if baseline:
                for f in pending:
                    conn.execute(
                        "INSERT INTO schema_migrations (version) VALUES (%s)", (f.name,)
                    )
                    print(f"  marcada como aplicada: {f.name}")
                return

            if pending and _schema_predates_runner(conn):
                raise SystemExit(
                    "La base ya tiene tablas de Telar pero schema_migrations está vacía:\n"
                    "se creó antes de este script. Si el esquema está al día, corré una vez\n"
                    "`python -m telar.db.migrate --baseline` (o `make migrate-baseline`)."
                )

            for f in pending:
                print(f"  aplicando {f.name} ...", flush=True)
                with conn.transaction():
                    conn.execute(f.read_text(encoding="utf-8"))
                    conn.execute(
                        "INSERT INTO schema_migrations (version) VALUES (%s)", (f.name,)
                    )
            print(f"Migraciones al día ({len(files)} en total, {len(pending)} aplicadas ahora).")
        finally:
            conn.execute("SELECT pg_advisory_unlock(%s)", (_LOCK_ID,))


def main() -> None:
    parser = argparse.ArgumentParser(description="Aplica las migraciones pendientes.")
    group = parser.add_mutually_exclusive_group()
    group.add_argument("--status", action="store_true", help="lista aplicadas y pendientes")
    group.add_argument(
        "--baseline", action="store_true", help="marca todas como aplicadas sin correrlas"
    )
    args = parser.parse_args()
    try:
        run(baseline=args.baseline, status=args.status)
    except psycopg.Error as e:
        print(f"Error de base de datos: {e}", file=sys.stderr)
        raise SystemExit(1) from e


if __name__ == "__main__":
    main()
