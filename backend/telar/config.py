"""Configuración por variables de entorno. Nada de secretos en el código."""

from __future__ import annotations

from functools import lru_cache
from typing import Literal

from cryptography.fernet import Fernet
from pydantic import model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

# Valores de los .env.example: si llegan a producción es que nadie los cambió.
_PLACEHOLDERS = {"cambia-esto-por-algo-aleatorio"}


class Settings(BaseSettings):
    # hide_input_in_errors: si la validación falla, el error NO debe imprimir
    # los valores (secretos y la contraseña de DATABASE_URL irían a los logs).
    model_config = SettingsConfigDict(env_file=".env", extra="ignore", hide_input_in_errors=True)

    # "production" hace obligatorios los secretos y rechaza los defaults de
    # desarrollo: la app no arranca antes que arrancar insegura.
    env: Literal["development", "production"] = "development"

    # Base de datos: la pone el usuario, es su Postgres.
    database_url: str = "postgresql://telar:telar@localhost:5432/telar"
    db_pool_max_size: int = 10

    # WhatsApp Cloud API
    meta_app_secret: str = ""
    meta_verify_token: str = ""
    meta_access_token: str = ""
    meta_phone_number_id: str = ""
    meta_api_version: str = "v21.0"

    # Clave de cifrado para tokens guardados en base de datos (Fernet).
    encryption_key: str = ""

    # Segundos de espera antes de invocar al agente, para agrupar los
    # mensajes que el usuario manda en ráfaga.
    debounce_seconds: float = 5.0

    # LLM por defecto del v0. Formato de init_chat_model: "proveedor:modelo".
    default_model: str = "anthropic:claude-sonnet-4-5"
    default_system_prompt: str = "Eres un asistente de atención al cliente. Responde breve y claro."

    # Anti-abuso: volumen de mensajes de WhatsApp por contacto y tope global
    # de invocaciones concurrentes al LLM.
    rate_limit_messages_per_window: int = 10
    rate_limit_window_seconds: float = 60
    rate_limit_max_concurrent_agent_calls: int = 20

    # Tamaño máximo aceptado del body del webhook, antes de leerlo.
    webhook_max_body_bytes: int = 65536

    # Dónde se guardan los archivos de media descargados de Meta (fotos,
    # audios, documentos). v0: disco local -- en producción es un volumen de
    # Docker montado acá; si algún día la API corre en más de una instancia
    # a la vez, este es el valor a apuntar a un mount compartido o a
    # reemplazar por S3/MinIO (ver media/storage.py).
    media_storage_dir: str = "./data/media"
    media_max_bytes: int = 20 * 1024 * 1024

    # Autenticación de usuarios (no de WhatsApp).
    jwt_secret: str = ""
    jwt_expire_minutes: int = 60 * 24
    login_rate_limit_attempts: int = 5
    login_rate_limit_window_seconds: float = 900

    # Origen permitido para el frontend (CORS). Un solo origin explícito,
    # no "*" -- ver README, sección de anti-abuso.
    frontend_origin: str = "http://localhost:5173"

    # Header del que leer la IP real del cliente cuando la API está detrás de
    # un proxy (p. ej. "CF-Connecting-IP" con Cloudflare Tunnel). Vacío = la
    # IP de la conexión. Solo es seguro si la API no es alcanzable sin pasar
    # por ese proxy -- si no, cualquiera inventa el header.
    trusted_client_ip_header: str = ""

    log_level: str = "INFO"

    @model_validator(mode="after")
    def _check_secrets(self) -> Settings:
        errors: list[str] = []

        # Siempre: sin estas dos la app no funciona, mejor saberlo al arrancar
        # que en el primer login o el primer mensaje.
        if not self.jwt_secret:
            errors.append("JWT_SECRET está vacío")
        try:
            Fernet(self.encryption_key.encode())
        except (ValueError, TypeError):
            errors.append("ENCRYPTION_KEY no es una clave Fernet válida")

        if self.env == "production":
            if len(self.jwt_secret) < 32:
                errors.append("JWT_SECRET debe tener al menos 32 caracteres")
            # Con META_APP_SECRET vacío la firma del webhook se calcula con
            # clave vacía y cualquiera puede falsificarla.
            for name in ("meta_app_secret", "meta_verify_token"):
                value = getattr(self, name)
                if not value or value in _PLACEHOLDERS:
                    errors.append(f"{name.upper()} está vacío o es el valor de ejemplo")
            if "telar:telar@" in self.database_url:
                errors.append("DATABASE_URL usa las credenciales de desarrollo (telar:telar)")
            if "localhost" in self.frontend_origin:
                errors.append("FRONTEND_ORIGIN apunta a localhost")

        if errors:
            raise ValueError(
                "Configuración inválida (ver backend/.env.example):\n  - " + "\n  - ".join(errors)
            )
        return self


@lru_cache
def settings() -> Settings:
    return Settings()
