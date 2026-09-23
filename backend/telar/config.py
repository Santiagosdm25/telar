"""Configuración por variables de entorno. Nada de secretos en el código."""

from __future__ import annotations

from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    # Base de datos: la pone el usuario, es su Postgres.
    database_url: str = "postgresql://telar:telar@localhost:5432/telar"

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

    log_level: str = "INFO"


@lru_cache
def settings() -> Settings:
    return Settings()
