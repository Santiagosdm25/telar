"""
Cifrado simétrico (Fernet) para secretos guardados en base de datos.

Cierra la deuda que el README ya documentaba ("Fernet está previsto, no
implementado"). Utilidad general, no solo para las tools configurables —
queda lista para cuando se cifren también los tokens de Meta.
"""

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
