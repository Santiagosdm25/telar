"""Tests de hash de password y JWT de sesión. Lógica pura, sin DB."""

from __future__ import annotations

import time
from uuid import uuid4

import jwt
import pytest

from telar.auth import security
from telar.config import settings


@pytest.fixture(autouse=True)
def _jwt_settings(monkeypatch):
    monkeypatch.setattr(settings(), "jwt_secret", "una-clave-de-prueba-bien-larga-1234567890")
    monkeypatch.setattr(settings(), "jwt_expire_minutes", 60)


def test_hash_and_verify_password_roundtrip():
    hashed = security.hash_password("correcthorsebatterystaple")
    assert security.verify_password("correcthorsebatterystaple", hashed)


def test_verify_password_rejects_wrong_password():
    hashed = security.hash_password("correcthorsebatterystaple")
    assert not security.verify_password("wrong", hashed)


def test_verify_dummy_password_does_not_raise():
    security.verify_dummy_password("cualquier-cosa")


def test_access_token_roundtrip():
    user_id = uuid4()
    token = security.create_access_token(user_id)
    assert security.decode_access_token(token) == user_id


def test_decode_rejects_expired_token(monkeypatch):
    monkeypatch.setattr(settings(), "jwt_expire_minutes", -1)
    token = security.create_access_token(uuid4())
    assert security.decode_access_token(token) is None


def test_decode_rejects_wrong_secret():
    now = time.time()
    bad_token = jwt.encode(
        {"sub": str(uuid4()), "iat": now, "exp": now + 60},
        "otra-clave-completamente-distinta-000000",
        algorithm="HS256",
    )
    assert security.decode_access_token(bad_token) is None


def test_decode_rejects_garbage_token():
    assert security.decode_access_token("no-es-un-jwt") is None
