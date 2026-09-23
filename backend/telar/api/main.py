"""Aplicación FastAPI. El webhook valida, deduplica y encola. Nada más."""

from __future__ import annotations

import json
import logging
from contextlib import asynccontextmanager

from fastapi import APIRouter, FastAPI, Request, Response
from fastapi.middleware.cors import CORSMiddleware

from telar.accounts.router import router as accounts_router
from telar.agent.router import router as agent_router
from telar.auth.router import router as auth_router
from telar.channels.meta import default_adapter
from telar.config import settings
from telar.conversations.router import router as conversations_router
from telar.custom_tools.router import router as tools_router
from telar.db import repositories as repo
from telar.db.pool import close_pool, get_pool
from telar.inboxes.router import router as inboxes_router
from telar.kb.router import router as kb_router
from telar.llm.router import router as llm_providers_router
from telar.tenant_db.router import router as tenant_db_router
from telar.worker.dispatcher import Dispatcher
from telar.worker.pipeline import Pipeline

logging.basicConfig(level=settings().log_level)
log = logging.getLogger("telar")

adapter = default_adapter()
pipeline = Pipeline(adapter)
dispatcher = Dispatcher(pipeline.handle, on_rate_limited=pipeline.handle_rate_limited)

router = APIRouter()


@router.get("/health")
async def health() -> dict[str, str]:
    return {"status": "ok"}


@router.get("/webhooks/whatsapp")
async def verify(request: Request) -> Response:
    challenge = adapter.verify_webhook(dict(request.query_params))
    if challenge is None:
        return Response(status_code=403)
    return Response(content=challenge, media_type="text/plain")


@router.post("/webhooks/whatsapp", response_model=None)
async def inbound(request: Request) -> dict[str, str] | Response:
    """
    Devuelve 200 siempre y de inmediato. Si tardas, Meta reintenta y acabas
    procesando el mismo mensaje varias veces.
    """
    # Se chequea antes de leer el body: sin esto, cualquiera en internet
    # (no hace falta la firma de Meta para llegar hasta acá) puede mandar
    # bodies enormes en bucle y gastar memoria antes de que el sistema
    # siquiera intente autenticar la request. El límite real de producción
    # va en el reverse proxy; esto es defensa en profundidad.
    content_length = request.headers.get("content-length")
    if content_length and int(content_length) > settings().webhook_max_body_bytes:
        return Response(status_code=413)

    raw = await request.body()

    if not adapter.verify_signature(raw, request.headers.get("X-Hub-Signature-256")):
        log.warning("firma inválida, payload descartado")
        return {"status": "ignored"}

    try:
        payload = json.loads(raw)
    except json.JSONDecodeError:
        # 200 igual: si devolvemos error, Meta reintenta indefinidamente
        # un body que nunca va a poder parsear.
        log.error("body del webhook no es JSON válido (%d bytes): %r", len(raw), raw[:200])
        return {"status": "ok"}

    phone_number_id = _phone_number_id(payload)
    if not phone_number_id:
        return {"status": "ok"}

    inbox = await repo.resolve_inbox(phone_number_id)
    if inbox is None:
        log.warning("phone_number_id %s sin inbox configurado", phone_number_id)
        return {"status": "ok"}

    for status in adapter.parse_statuses(payload):
        await repo.update_message_delivery_status(**status)

    messages = adapter.parse(
        payload, account_id=inbox["account_id"], inbox_id=inbox["id"]
    )

    for msg in messages:
        if await repo.already_processed(msg.inbox_id, msg.channel_message_id):
            continue
        await dispatcher.submit(msg)

    return {"status": "ok"}


def _phone_number_id(payload: dict) -> str | None:
    for entry in payload.get("entry", []):
        for change in entry.get("changes", []):
            meta = change.get("value", {}).get("metadata", {})
            if meta.get("phone_number_id"):
                return meta["phone_number_id"]
    return None


@asynccontextmanager
async def lifespan(app: FastAPI):
    await get_pool()
    await dispatcher.recover_pending()
    log.info("telar listo")
    yield
    await dispatcher.drain()
    await close_pool()


app = FastAPI(title="Telar", version="0.1.0", lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=[settings().frontend_origin],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
app.include_router(router)
app.include_router(auth_router)
app.include_router(accounts_router)
app.include_router(conversations_router)
app.include_router(agent_router)
app.include_router(inboxes_router)
app.include_router(tools_router)
app.include_router(kb_router)
app.include_router(llm_providers_router)
app.include_router(tenant_db_router)
