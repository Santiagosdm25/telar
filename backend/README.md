# Telar — backend

API, webhook de WhatsApp, agente y base de datos. Python 3.12 · FastAPI · LangGraph · Postgres 16 con pgvector · SQL plano sin ORM.

Para qué es Telar y cómo se arma el proyecto completo (backend + panel), ver el [README de la raíz](../README.md). Lo que falta para producción está en [`docs/AUDITORIA.md`](../docs/AUDITORIA.md).

## Desarrollo

Desde la raíz del repo o desde esta carpeta (el `Makefile` de la raíz delega en el de acá):

```bash
cp .env.example .env        # y llenarlo: ver Configuración
make up                     # Postgres + API en http://localhost:8000
make superadmin EMAIL=vos@empresa.com NAME="Tu Nombre"
make logs                   # logs de la API en vivo
```

| Atajo | Qué hace |
|---|---|
| `make up` / `make down` | Levanta / apaga `db` y `api` |
| `make superadmin` / `make user` | Crea un usuario (con o sin superadmin); pide la contraseña por consola |
| `make password EMAIL=…` | Resetea la contraseña de un usuario |
| `make login EMAIL=…` | Prueba el login y muestra el token |

La documentación interactiva de la API queda en `http://localhost:8000/docs`.

**Migraciones:** los archivos de `migrations/` se aplican solos **solo la primera vez** que se crea el volumen de Postgres. En una base que ya existe, una migración nueva hay que aplicarla a mano con `psql`. Es un pendiente conocido (auditoría, R-A4).

### Tests

```bash
pip install -e ".[dev]"
pytest                          # unitarios
pytest -m integration           # contra un Postgres real (excluidos por defecto); ver tests/integration/conftest.py
```

## Exponer el webhook

Meta necesita una URL pública con HTTPS. Cloudflare Tunnel sirve para desarrollo y producción: crea un túnel en el dashboard de Cloudflare (Zero Trust → Networks → Tunnels), pega su token en `CLOUDFLARE_TUNNEL_TOKEN` y levántalo aparte:

```bash
docker compose --profile tunnel up -d tunnel
```

También funciona tu propio reverse proxy con TLS (Caddy, nginx); el servicio `tunnel` es opcional.

En la consola de Meta, apunta el webhook a `https://tu-dominio/webhooks/whatsapp`, pega el mismo `META_VERIFY_TOKEN` y suscríbete al campo `messages`. Después conecta el número desde el panel (**Configuración → Inboxes**): el `phone_number_id` es la llave que enruta cada webhook hacia su cuenta, su bot y su base de conocimiento.

## Configuración

Todo por variables de entorno (`.env`), leídas en `telar/config.py`.

| Variable | Para qué | Default |
|---|---|---|
| `DATABASE_URL` | Postgres: estado, memoria del agente y vectores | `postgresql://telar:telar@localhost:5432/telar` (en Docker lo fija el compose) |
| `META_APP_SECRET` | Valida la firma del webhook. **Obligatoria**: vacía, cualquiera puede firmar webhooks falsos | — |
| `META_VERIFY_TOKEN` | Cadena que inventas y pegas en la consola de Meta | — |
| `META_ACCESS_TOKEN`, `META_PHONE_NUMBER_ID` | Credenciales globales, solo como respaldo de inboxes sin token propio | — |
| `META_API_VERSION` | Versión de la Graph API | `v21.0` |
| `ENCRYPTION_KEY` | Clave Fernet que cifra tokens, API keys y credenciales en la base. **Obligatoria** | — |
| `JWT_SECRET` | Firma las sesiones del panel. **Obligatoria**, 32+ caracteres | — |
| `JWT_EXPIRE_MINUTES` | Duración de la sesión | `1440` (24 h) |
| `FRONTEND_ORIGIN` | Origen exacto del panel para CORS (uno solo, no `*`) | `http://localhost:5173` |
| `DEFAULT_MODEL` | Modelo por defecto, formato `proveedor:modelo` | `anthropic:claude-sonnet-4-5` |
| `ANTHROPIC_API_KEY`, `OPENAI_API_KEY` | Claves de proveedor. `OPENAI_API_KEY` también se usa para los embeddings de las bases de conocimiento | — |
| `DEBOUNCE_SECONDS` | Espera antes de responder, para agrupar ráfagas | `5` |
| `RATE_LIMIT_MESSAGES_PER_WINDOW`, `RATE_LIMIT_WINDOW_SECONDS` | Mensajes por contacto por ventana | `10` / `60` |
| `RATE_LIMIT_MAX_CONCURRENT_AGENT_CALLS` | Tope global de llamadas simultáneas al LLM | `20` |
| `LOGIN_RATE_LIMIT_ATTEMPTS`, `LOGIN_RATE_LIMIT_WINDOW_SECONDS` | Intentos de login por IP | `5` / `900` |
| `WEBHOOK_MAX_BODY_BYTES` | Tamaño máximo del body del webhook | `65536` |
| `MEDIA_STORAGE_DIR`, `MEDIA_MAX_BYTES` | Dónde y hasta qué tamaño se guardan fotos/audios/documentos | `./data/media` / 20 MB |
| `LOG_LEVEL` | Nivel de log | `INFO` |
| `CLOUDFLARE_TUNNEL_TOKEN` | Solo si usas el servicio `tunnel` | — |

Hoy la app **arranca aunque falten las obligatorias** y queda insegura; validarlas al arranque es lo primero de la auditoría.

### Modelos

Telar usa `init_chat_model` de LangChain: cualquier proveedor soportado sirve cambiando una cadena (`anthropic:claude-sonnet-4-5`, `openai:gpt-4.1`, `ollama:llama3.1`). Cada cuenta puede además configurar sus propios proveedores desde el panel (**Configuración → Proveedor LLM**). La imagen de Docker ya trae los extras `openai` y `ollama`.

## Estructura

```
telar/
  api/            FastAPI y webhook (main.py)
  channels/       adaptadores de canal; hoy solo Meta WhatsApp
  worker/         buffer de ráfagas (dispatcher) y pipeline de cada turno
  agent/          compilador de grafos, caché, checkpointer, tools del sistema
  core/           tipos normalizados, máquina de estados, cifrado, rate limit
  db/             pool y repositorios por dominio (SQL plano)
  auth/           login, JWT, roles, CLIs de usuarios
  accounts/       cuentas, miembros y equipos
  conversations/  bandeja: conversaciones, mensajes, plantillas, media
  inboxes/        números de WhatsApp conectados
  llm/            proveedores de modelos por cuenta
  kb/             bases de conocimiento (fragmentado + embeddings)
  custom_tools/   herramientas HTTP y SQL por cuenta
  tenant_db/      base de datos externa de cada cuenta
  media/          almacenamiento de archivos
migrations/       esquema SQL (001–009)
tests/            unitarios + integración
```

Dos archivos concentran las decisiones importantes:

- `core/types.py` define la frontera con el mundo exterior. Si vas a agregar un canal, empieza por `ChannelAdapter`.
- `core/state.py` define el traspaso a humano. `should_bot_reply()` se consulta antes de invocar el grafo: si un asesor tiene la conversación, el mensaje se guarda pero la IA no genera nada.

## El traspaso a humano

- `bot` — la IA responde.
- `pending` — se pidió un asesor, está en la cola del equipo, la IA ya calló.
- `open` — un asesor la tomó. La IA solo guarda mensajes.
- `resolved` — cerrada. Si el contacto vuelve a escribir, se abre una conversación **nueva** en `bot` (sin la memoria de la anterior).

El agente pide el traspaso llamando la herramienta `escalar_a_humano`. El resto lo maneja la máquina de estados, fuera del grafo.

## Cuentas, equipos y roles

Cada cliente es una cuenta; crear cuentas es solo para superadmin. El primer superadmin se crea por consola (`make superadmin`); a partir de ahí todo se hace desde el panel o la API. Sumar a alguien por email lo crea si no existe, con una contraseña temporal.

| | `administrator` | `supervisor` | `agent` |
|---|---|---|---|
| Ver miembros, equipos, conversaciones y contactos | ✅ | ✅ | ✅ |
| Sumar/sacar miembros | ✅ | solo asesores | ❌ |
| Crear equipos | ✅ | ❌ | ❌ |
| Sumar/sacar gente de un equipo | ✅ | ✅ | ❌ |
| Asignar conversaciones a otra persona | ✅ | ✅ | ❌ |
| Configuración, bot, herramientas, bases de conocimiento | ✅ | ❌ | ❌ |

`is_superadmin` (flag en `users`, no un rol) tiene acceso a todas las cuentas. Tomar una conversación para uno mismo es libre; responder exige tenerla asignada (o ser administrador/supervisor) y que esté `open` — si no, `409` o `403`.

## Bases de conocimiento

El agente tiene la herramienta `consultar_base_de_conocimiento`, que busca por similitud en pgvector. No es un paso fijo de RAG: el modelo decide cuándo llamarla. Se crean y se cargan desde el panel (**Configuración → Bases de conocimiento**) o con `POST /accounts/{id}/knowledge-bases` y `…/{kb_id}/ingest`; también hay un script: `python -m telar.kb.ingest <knowledge_base_id> archivo.txt`.

El embedding es `text-embedding-3-small` de OpenAI (requiere `OPENAI_API_KEY`). La columna `kb_chunks.embedding` es `vector(1536)`: cambiar de modelo implica alterar la columna.

## Herramientas configurables

Cada cuenta puede definir tools `http` (llamar una API externa) o `sql` (consultar su propia base Postgres). El agente decide cuándo llamarlas. Se crean desde el panel (**Configuración → Herramientas**) o por API; el secreto (headers, connection string) se cifra con Fernet y ningún endpoint lo devuelve. Los cambios se ven sin reiniciar: la caché del grafo se invalida sola.

Restricciones deliberadas:
- **`sql` es de solo lectura**, impuesto por Postgres a nivel de transacción (`READ ONLY`), no por un chequeo de texto. Solo Postgres.
- **`http` no puede apuntar a IPs privadas/internas** (loopback, RFC1918, metadata de la nube); se revisa en cada llamada.

Ver la auditoría (S-C2, S-A3) para los huecos pendientes en ambas.

## Compilador de grafos

El agente se compila desde un JSON guardado en `bot_versions.graph` con `build_graph()`. Es el contrato entre el constructor visual del panel y el runtime. Sin bot propio, la cuenta usa un grafo por defecto de un nodo.

Formato — una cadena lineal de nodos `agent` (todavía sin ramas condicionales):

```json
{
  "nodes": [
    {"id": "triage", "type": "agent", "system_prompt": "Detectá qué necesita el cliente.", "tools": []},
    {"id": "respuesta", "type": "agent", "system_prompt": "Respondé con la base de conocimiento.", "tools": ["consultar_base_de_conocimiento", "escalar_a_humano"]}
  ],
  "edges": [
    {"from": "START", "to": "triage"},
    {"from": "triage", "to": "respuesta"},
    {"from": "respuesta", "to": "END"}
  ]
}
```

- `system_prompt` es opcional; si falta, usa el global (`default_system_prompt` en `config.py`).
- `tools` es opcional; si falta, el nodo tiene todas las disponibles; `[]` significa ninguna.

Se edita desde el panel (**Flujo del bot**, con chat de prueba) o con `PUT /accounts/{id}/bot`, que compila el grafo con las tools reales antes de guardar: un JSON inválido no llega a la base. Cada guardado crea una versión y se puede volver a una anterior. Existe también `python -m telar.agent.deploy_bot`, pero no invalida la caché de los procesos que ya están corriendo (auditoría, R-M13).

## Anti-abuso

Son la segunda capa, no la primera: en producción va un reverse proxy/CDN delante (TLS, rate limiting, límite de body).

- **Mensajes de WhatsApp:** tope por contacto por ventana; el exceso se guarda como `rate_limited` sin invocar al LLM.
- **LLM:** tope global de llamadas simultáneas.
- **Login:** intentos por IP por ventana.
- **Webhook:** `413` antes de leer el body si supera el tope.

## Deuda conocida

La lista completa, priorizada y con esfuerzos, está en [`docs/AUDITORIA.md`](../docs/AUDITORIA.md). Lo más importante: validación de secretos al arrancar, destinos internos en la tool SQL, mensajes que se pierden si el LLM o Meta fallan a mitad de un turno, sistema de migraciones y reintentos al enviar a Meta.
