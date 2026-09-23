"""
Cifrado del `secret_config` de una tool configurable.

Módulo hoja a propósito: tanto `loader.py` (arma las tools en runtime) como
`service.py` (las crea/edita desde el CLI o el router HTTP) lo necesitan, y
`service.py` a su vez depende de `agent.graph_cache` -- que depende de
`loader.py`. Si estas funciones vivieran en `service.py`, `loader.py`
tendría que importarlo y se cerraría un ciclo de imports.
"""

from __future__ import annotations

import json

from telar.core import crypto


def encrypt_secret(secret: dict | None) -> bytes | None:
    return crypto.encrypt(json.dumps(secret)).encode() if secret else None


def decrypt_secret(secret_config: bytes | None) -> dict:
    if not secret_config:
        return {}
    return json.loads(crypto.decrypt(secret_config.decode()))
