"""Hash de contraseñas y JWT de sesión para usuarios del panel (no contactos de WhatsApp)."""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from uuid import UUID

import bcrypt
import jwt

from telar.config import settings

_ALGORITHM = "HS256"

# Hash fijo para cuando el email no existe: el tiempo de /auth/login no revela si está registrado.
_DUMMY_HASH = bcrypt.hashpw(b"no-existe", bcrypt.gensalt())


def hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode(), bcrypt.gensalt()).decode()


def verify_password(password: str, password_hash: str) -> bool:
    return bcrypt.checkpw(password.encode(), password_hash.encode())


def verify_dummy_password(password: str) -> None:
    """Gasta el mismo tiempo que verify_password, sin revelar nada."""
    bcrypt.checkpw(password.encode(), _DUMMY_HASH)


def create_access_token(user_id: UUID) -> str:
    now = datetime.now(timezone.utc)
    payload = {
        "sub": str(user_id),
        "iat": now,
        "exp": now + timedelta(minutes=settings().jwt_expire_minutes),
    }
    return jwt.encode(payload, settings().jwt_secret, algorithm=_ALGORITHM)


def decode_access_token(token: str) -> UUID | None:
    try:
        payload = jwt.decode(token, settings().jwt_secret, algorithms=[_ALGORITHM])
    except jwt.InvalidTokenError:
        return None
    try:
        return UUID(payload["sub"])
    except (KeyError, ValueError):
        return None
