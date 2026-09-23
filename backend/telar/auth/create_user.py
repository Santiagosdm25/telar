"""
Bootstrap de un usuario. v0 no tiene API de administración: se crea a mano,
igual que cuenta, inbox y base de conocimiento (ver README). Vincularlo a
una cuenta con un rol es un INSERT INTO account_users aparte.

Uso:
    python -m telar.auth.create_user <email> <nombre> [--superadmin]
"""

from __future__ import annotations

import argparse
import asyncio
import getpass

from telar.auth.security import hash_password
from telar.db import repositories as repo


async def create_user(email: str, name: str, password: str, is_superadmin: bool) -> None:
    password_hash = hash_password(password)
    user_id = await repo.insert_user(email, name, password_hash, is_superadmin)
    print(f"Usuario creado: {user_id}")


def main() -> None:
    parser = argparse.ArgumentParser(description="Crea un usuario administrador.")
    parser.add_argument("email")
    parser.add_argument("name")
    parser.add_argument("--superadmin", action="store_true")
    args = parser.parse_args()

    password = getpass.getpass("Password: ")
    confirm = getpass.getpass("Confirmar password: ")
    if password != confirm:
        raise SystemExit("Las contraseñas no coinciden.")

    asyncio.run(create_user(args.email, args.name, password, args.superadmin))


if __name__ == "__main__":
    main()
