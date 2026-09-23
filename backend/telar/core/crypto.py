"""Cifrado simétrico (Fernet) para secretos guardados en base de datos."""

from __future__ import annotations

from functools import lru_cache

from cryptography.fernet import Fernet

from telar.config import settings


@lru_cache
def _fernet() -> Fernet:
    return Fernet(settings().encryption_key.encode())


def encrypt(plaintext: str) -> str:
    return _fernet().encrypt(plaintext.encode()).decode()


def decrypt(ciphertext: str) -> str:
    return _fernet().decrypt(ciphertext.encode()).decode()
