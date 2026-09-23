"""Cifrado del `secret_config` de una tool. Módulo hoja para evitar un ciclo loader <-> service."""

from __future__ import annotations

import json

from telar.core import crypto


def encrypt_secret(secret: dict | None) -> bytes | None:
    return crypto.encrypt(json.dumps(secret)).encode() if secret else None


def decrypt_secret(secret_config: bytes | None) -> dict:
    if not secret_config:
        return {}
    return json.loads(crypto.decrypt(secret_config.decode()))
