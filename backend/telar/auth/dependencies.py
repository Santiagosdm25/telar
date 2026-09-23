"""Dependencias de FastAPI para autenticar y autorizar endpoints."""

from __future__ import annotations

from uuid import UUID

from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from pydantic import BaseModel

from telar.auth.roles import AccountRole
from telar.auth.security import decode_access_token
from telar.db import repositories as repo

_bearer = HTTPBearer(auto_error=False)

_UNAUTHORIZED = HTTPException(
    status_code=status.HTTP_401_UNAUTHORIZED,
    detail="No autenticado",
    headers={"WWW-Authenticate": "Bearer"},
)


async def get_current_user(
    credentials: HTTPAuthorizationCredentials | None = Depends(_bearer),
) -> dict:
    """
    Busca al usuario fresco en la base de datos en cada request, no solo lo
    que dice el token: así un usuario borrado queda bloqueado de inmediato,
    no recién cuando expire el token.
    """
    if credentials is None:
        raise _UNAUTHORIZED

    user_id = decode_access_token(credentials.credentials)
    if user_id is None:
        raise _UNAUTHORIZED

    user = await repo.get_user_by_id(user_id)
    if user is None:
        raise _UNAUTHORIZED

    return user


class Membership(BaseModel):
    user_id: UUID
    account_id: UUID
    role: AccountRole | None  # None cuando el acceso es por bypass de superadmin
    is_superadmin: bool


def require_role(*roles: AccountRole):
    """
    Dependencia por endpoint: exige que el usuario autenticado pertenezca a
    la cuenta del path (account_id, tomado automáticamente del path de la
    ruta que la use) con alguno de los roles dados. Sin roles
    (require_role()) alcanza con pertenecer a la cuenta, con el rol que
    sea. is_superadmin es bypass total sobre cualquier cuenta.
    """

    async def _check(
        account_id: UUID, user: dict = Depends(get_current_user)
    ) -> Membership:
        if user["is_superadmin"]:
            return Membership(
                user_id=user["id"], account_id=account_id, role=None, is_superadmin=True
            )

        row = await repo.get_account_membership(account_id, user["id"])
        if row is None:
            raise HTTPException(status.HTTP_403_FORBIDDEN, "No pertenecés a esta cuenta")

        if roles and row["role"] not in [r.value for r in roles]:
            raise HTTPException(status.HTTP_403_FORBIDDEN, "No tenés permiso para esto")

        return Membership(
            user_id=user["id"],
            account_id=account_id,
            role=AccountRole(row["role"]),
            is_superadmin=False,
        )

    return _check
