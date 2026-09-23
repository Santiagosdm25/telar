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
    # Que un error de validación no imprima secretos en los logs.
    model_config = SettingsConfigDict(env_file=".env", extra="ignore", hide_input_in_errors=True)

    # "production" exige secretos y rechaza los defaults de desarrollo.
    env: Literal["development", "production"] = "development"

    database_url: str = "postgresql://telar:telar@localhost:5432/telar"
    db_pool_max_size: int = 10

    meta_app_secret: str = ""
    meta_verify_token: str = ""
    meta_access_token: str = ""
    meta_phone_number_id: str = ""
    meta_api_version: str = "v21.0"

    encryption_key: str = ""

    # Debounce para agrupar mensajes en ráfaga.
    debounce_seconds: float = 5.0

    # Formato de init_chat_model: "proveedor:modelo".
    default_model: str = "anthropic:claude-sonnet-4-5"
    default_system_prompt: str = "Eres un asistente de atención al cliente. Responde breve y claro."

    # Anti-abuso: límite por contacto y tope global de invocaciones al LLM.
    rate_limit_messages_per_window: int = 10
    rate_limit_window_seconds: float = 60
    rate_limit_max_concurrent_agent_calls: int = 20

    webhook_max_body_bytes: int = 65536

    # Disco local; con más de una instancia debe ser un mount compartido.
    media_storage_dir: str = "./data/media"
    media_max_bytes: int = 20 * 1024 * 1024

    jwt_secret: str = ""
    jwt_expire_minutes: int = 60 * 24
    login_rate_limit_attempts: int = 5
    login_rate_limit_window_seconds: float = 900

    # Un solo origin explícito, nunca "*".
    frontend_origin: str = "http://localhost:5173"

    # p. ej. "CF-Connecting-IP". Solo es seguro si la API no es alcanzable sin pasar por ese proxy.
    trusted_client_ip_header: str = ""

    log_level: str = "INFO"

    @model_validator(mode="after")
    def _check_secrets(self) -> Settings:
        errors: list[str] = []

        # Sin estas dos la app no funciona: fallar al arrancar.
        if not self.jwt_secret:
            errors.append("JWT_SECRET está vacío")
        try:
            Fernet(self.encryption_key.encode())
        except (ValueError, TypeError):
            errors.append("ENCRYPTION_KEY no es una clave Fernet válida")

        if self.env == "production":
            if len(self.jwt_secret) < 32:
                errors.append("JWT_SECRET debe tener al menos 32 caracteres")
            # Con secreto vacío cualquiera puede falsificar la firma del webhook.
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
