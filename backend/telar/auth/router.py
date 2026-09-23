"""Endpoints de autenticación de usuarios (agentes, administradores)."""

from __future__ import annotations

from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Request, status
from pydantic import BaseModel

from telar.auth.dependencies import get_current_user
from telar.auth.security import (
    create_access_token,
    hash_password,
    verify_dummy_password,
    verify_password,
)
from telar.config import settings
from telar.core import ratelimit
from telar.db import repositories as repo

router = APIRouter(prefix="/auth", tags=["auth"])

_INVALID_CREDENTIALS = HTTPException(
    status_code=status.HTTP_401_UNAUTHORIZED, detail="Credenciales inválidas"
)


class LoginRequest(BaseModel):
    email: str
    password: str


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"


class AccountMembership(BaseModel):
    account_id: UUID
    role: str


class MeResponse(BaseModel):
    id: UUID
    email: str
    name: str
    is_superadmin: bool
    accounts: list[AccountMembership]


class ChangePasswordRequest(BaseModel):
    current_password: str
    new_password: str


@router.post("/login", response_model=TokenResponse)
async def login(body: LoginRequest, request: Request) -> TokenResponse:
    # Rate limit por IP: protege contra fuerza bruta sobre el password.
    client_ip = request.client.host if request.client else "desconocido"
    allowed = await ratelimit.allow(
        f"login:{client_ip}",
        settings().login_rate_limit_attempts,
        settings().login_rate_limit_window_seconds,
    )
    if not allowed:
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail="Demasiados intentos, esperá unos minutos.",
        )

    user = await repo.get_user_by_email(body.email)

    # Se corre el hash incluso si el email no existe: el tiempo de
    # respuesta no debe delatar si está registrado (evita enumeración).
    if user is None:
        verify_dummy_password(body.password)
        raise _INVALID_CREDENTIALS

    if not verify_password(body.password, user["password_hash"]):
        raise _INVALID_CREDENTIALS

    token = create_access_token(user["id"])
    return TokenResponse(access_token=token)


@router.get("/me", response_model=MeResponse)
async def me(user: dict = Depends(get_current_user)) -> MeResponse:
    accounts = await repo.get_user_accounts(user["id"])
    return MeResponse(
        id=user["id"],
        email=user["email"],
        name=user["name"],
        is_superadmin=user["is_superadmin"],
        accounts=[AccountMembership(**a) for a in accounts],
    )


@router.post("/change-password", status_code=status.HTTP_204_NO_CONTENT)
async def change_password(
    body: ChangePasswordRequest, user: dict = Depends(get_current_user)
) -> None:
    """
    Para el caso de "sumar miembro" (accounts/router.py:add_member): a un
    usuario recién creado se le entrega una contraseña temporal fuera de
    banda, y esto es lo que usa para fijar la suya en el primer login.
    """
    if not verify_password(body.current_password, user["password_hash"]):
        raise _INVALID_CREDENTIALS
    await repo.update_user_password(user["id"], hash_password(body.new_password))
