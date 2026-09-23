"""
Resetea la contraseña de un usuario existente, por email. Complemento de
create_user.py para cuando la contraseña se pierde (no hay flujo de
recuperación por email todavía).

Uso:
    python -m telar.auth.reset_password <email>
"""

from __future__ import annotations

import argparse
import asyncio
import getpass

from telar.auth.security import hash_password
from telar.db import repositories as repo


async def reset_password(email: str, password: str) -> None:
    user = await repo.get_user_by_email(email)
    if user is None:
        raise SystemExit(f"No existe un usuario con email {email}.")
    await repo.update_user_password(user["id"], hash_password(password))
    print(f"Contraseña actualizada para {email}")


def main() -> None:
    parser = argparse.ArgumentParser(description="Resetea la contraseña de un usuario.")
    parser.add_argument("email")
    args = parser.parse_args()

    password = getpass.getpass("Nueva password: ")
    confirm = getpass.getpass("Confirmar password: ")
    if password != confirm:
        raise SystemExit("Las contraseñas no coinciden.")

    asyncio.run(reset_password(args.email, password))


if __name__ == "__main__":
    main()
