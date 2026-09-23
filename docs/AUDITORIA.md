# Auditoría de Telar — 2026-09-23

Revisión completa del proyecto en cuatro frentes: seguridad del backend,
confiabilidad del backend, frontend e infraestructura. Todo se verificó
leyendo el código real; lo que no se pudo confirmar del todo está marcado
**(PLAUSIBLE)**. Rutas relativas a la raíz del repo.

Este documento reemplaza a `MEJORAS_PROPUESTAS.md` y `PLAN_ESCALABILIDAD.md`:
lo que seguía vigente de esas notas está incorporado acá (sección 7).

---

## Avance

**2026-09-23 — salida a producción** (ver [`DEPLOY.md`](DEPLOY.md)):

| Hallazgo | Estado |
|---|---|
| S-C1 / I-C3 · secretos vacíos aceptados | ✅ `config.py` valida al arrancar (siempre `JWT_SECRET`/`ENCRYPTION_KEY`; con `ENV=production` todo lo demás). Sin `META_APP_SECRET` el webhook rechaza toda firma. |
| R-A4 / I-C1 · sin sistema de migraciones | ✅ `telar/db/migrate.py` + tabla `schema_migrations`, corre antes de la API. Probado sobre base vacía (esquema idéntico al existente) e idempotente. |
| I-C2 · Postgres publicado con `telar/telar` | ✅ en dev solo en `127.0.0.1`; en producción no hay Postgres en el compose (base externa). Falta: usuario de base sin superusuario en Postgres propio (documentado). |
| M5 infra · compose pisa `DATABASE_URL` | ✅ `deploy/docker-compose.prod.yml` lo lee del `.env`. |
| I-A2 parcial · TLS / API expuesta | ✅ en producción la API solo escucha en localhost; HTTPS por Cloudflare Tunnel. |
| S-M2 · rate limit de login global detrás del túnel | ✅ `TRUSTED_CLIENT_IP_HEADER=CF-Connecting-IP` en producción. |
| M3 infra / R-M15 parcial · healthcheck | ✅ `/health` consulta la base; healthcheck y `stop_grace_period` en el compose de producción. |
| M7 infra parcial · logs sin rotación | ✅ rotación en el compose de producción. |
| M1 infra · caché del Dockerfile | 🟡 las migraciones ya no invalidan el `pip install`; el código sí (falta lockfile, I-A1). |
| — · compatibilidad con poolers (Supabase/PgBouncer) | ✅ pool sin prepared statements. |

**2026-09-23 — agentes y sub-agentes en el flujo del bot:**

| Hallazgo | Estado |
|---|---|
| R-A2 · `memory_window` corta pares tool-call/resultado | ✅ `trim_history()` siempre empieza en un mensaje del cliente; v2 exige ≥ 1. |
| R-M4 · al cliente le llega `[{'type': 'text'…}]` | ✅ `message_text()` concatena los bloques de texto. |
| R-M5 · detección del traspaso frágil (últimos 3 mensajes) | ✅ `tool_called_this_turn()` mira todo el turno. |
| R-M3 parcial · validación del grafo | ✅ en v2: ids, roles, un solo principal, un nivel, tipos, descripción obligatoria. v1 sin cambios. |
| F-A4 · `memory_window` vacío guarda 0 | ✅ el campo exige ≥ 1. |
| F-M2 · el constructor pierde nodos sueltos | ✅ en v2 se guardan los agentes y las herramientas sueltas con su posición. |
| F-M3 · borrar con el teclado no marca "sin guardar" | ✅ mover o borrar en el lienzo marca "sin guardar". |

Siguen abiertos los críticos de código: **S-C2, S-C3, R-C1, R-C2**.

---

## 1. Resumen

**El diseño es bueno; la puesta en producción no está lista.** La
arquitectura (canal desacoplado, traspaso a humano como máquina de estados,
estado compartido en Postgres, flujos como JSON versionado) está bien
pensada, y el aislamiento entre cuentas en los endpoints normales está bien
hecho. Los problemas serios están en tres lugares:

1. **Configuración que falla abierta**: si falta un secreto, la app arranca
   igual y queda insegura. Hoy tu `.env` tiene `META_APP_SECRET` vacío.
2. **Funciones que se conectan a destinos elegidos por el cliente** (tool
   SQL, `base_url` del LLM, prueba de base externa, tool HTTP): permiten
   llegar a la red interna o robar secretos de la plataforma.
3. **Mensajes que se pierden en silencio**: si el LLM o Meta fallan en
   medio de un turno, ese cliente no recibe respuesta nunca y nada lo avisa.

| Área | Estado | Crítico | Alto |
|---|---|---|---|
| Seguridad backend | 🔴 No vender así | 3 | 7 |
| Confiabilidad backend | 🔴 Pierde mensajes ante fallas | 2 | 7 |
| Frontend | 🟡 Usable, con huecos de sesión | 0 | 5 |
| Infraestructura | 🔴 Solo apta para desarrollo | 3 | 5 |

Esfuerzo estimado para cerrar todo lo crítico y alto: **~60–80 horas**
(2–3 semanas de una persona). No hace falta reescribir nada: son arreglos
puntuales sobre una base sana.

---

## 2. Los 10 que hay que arreglar primero

En orden. Los tres primeros son de minutos y cierran los agujeros más fáciles
de explotar.

| # | Qué | Por qué importa | Esfuerzo |
|---|---|---|---|
| 1 | **Validar secretos al arrancar** (`backend/telar/config.py`) | Con `META_APP_SECRET` vacío cualquiera firma webhooks falsos y mete mensajes en cualquier cuenta; con `JWT_SECRET` vacío se falsifican sesiones de superadmin. | 1–2 h |
| 2 | **No publicar Postgres** y sacar `telar/telar` del compose (`backend/docker-compose.yml:10-17,28`) | En un VPS la base queda abierta a internet con usuario superadmin y contraseña conocida. | 1 h |
| 3 | **Exigir `api_key` cuando hay `base_url` propio** (`backend/telar/agent/graph_cache.py:67-74`) | Un cliente apunta su proveedor LLM a un servidor suyo y recibe tu API key de OpenAI/Anthropic. | 2 h |
| 4 | **Bloquear hosts internos en tool SQL y prueba de base externa** (`custom_tools/sql_tool.py`, `tenant_db/router.py`) + usuario de DB sin superusuario | Un admin de cualquier cuenta lee la base central: usuarios, mensajes y contactos de **todas** las cuentas. | 4–5 h |
| 5 | **Que un fallo del LLM/Meta no pierda el mensaje** (`worker/pipeline.py`, `worker/dispatcher.py`) | Hoy un corte de 2 minutos del proveedor deja sin respuesta, para siempre, a todos los que escribieron en ese lapso. | 6–10 h |
| 6 | **Releer el estado antes de enviar** (`worker/pipeline.py:60-137`) | El bot le habla encima a un asesor que acaba de tomar la conversación, y le pisa la asignación. | 4–6 h |
| 7 | **Sistema de migraciones** (`backend/docker-compose.yml:15`) | Las migraciones nuevas nunca se aplican a una base existente: cada cliente queda con un esquema distinto y la app rompe. | 4–6 h |
| 8 | **Reintentos al enviar a Meta** (`channels/meta.py`, `worker/pipeline.py:157-164`) | Un 429/5xx de Meta = mensaje perdido. `SendResult.retryable` existe pero nadie lo lee. | 3–4 h |
| 9 | **Arreglar permisos de equipos y roles** (`accounts/router.py:135-153,250-282`) | Un supervisor puede degradar al administrador (incluso al último) y ver/editar equipos de otra cuenta. | 2–3 h |
| 10 | **Backups de Postgres + CI con los tests** | Sin backups no hay qué ofrecer en un contrato; sin CI un commit roto llega directo a todos los clientes. | 12–18 h |

---

## 3. Plan por fases

**Fase 1 — Cerrar agujeros (1 semana).** Puntos 1–4 y 9, más: token de Meta
obligatorio por inbox y validado contra Meta (S-A5), SSRF por DNS rebinding
en la tool HTTP (S-A4), límites a la subida de bases de conocimiento (S-M5).
Al terminar: se puede dejar a un tercero administrar su cuenta sin que
alcance a los demás.

**Fase 2 — No perder mensajes (1 semana).** Puntos 5–8, más: recorte seguro
de historial (R-A2), poda de checkpoints (R-A3), timeouts en LLM y SQL
(R-M9), límite de body del webhook (R-A6), sesión que se cierra bien al
vencer (F-A1). Al terminar: una falla del proveedor retrasa respuestas, no
las pierde.

**Fase 3 — Producción (1 semana).** Punto 10, más: lockfile de dependencias
(I-A1), TLS y reverse proxy (I-A2), healthchecks y apagado ordenado (I-M3),
logs estructurados y alertas (I-M6), rotación de logs y limpieza de tablas
(I-M7). Al terminar: se puede firmar un SLA.

**Fase 4 — Escalar (cuando haga falta).** Lock por contacto en Postgres para
varias réplicas (R-A7), media en S3/R2 (I-M8), índices (R-M13), semáforo del
LLM por cuenta, clave de cifrado por cuenta, polling → SSE (F-M12), prueba
de carga.

Sobre las **100 solicitudes/minuto**: la ingesta las aguanta con un proceso.
La generación de respuestas no tiene margen si los turnos usan tools (techo
de 60–80/min con el semáforo actual de 20), y hoy un 429 del proveedor
pierde mensajes. Para garantizarlas: fases 1–3 completas, 2 réplicas con 2
workers cada una (requiere R-A7 e I-M8), subir el tier del proveedor LLM y
una prueba de carga con k6 que lo demuestre.

---

## 4. Hallazgos detallados

Códigos: **S** seguridad · **R** confiabilidad · **F** frontend · **I**
infraestructura. Cuando dos revisiones encontraron lo mismo, está una sola
vez.

### 4.1 Seguridad (backend)

**Críticos**

- **S-C1 · Secretos vacíos aceptados.** `config.py:17,18,24,52` tienen `""`
  por defecto y nada valida al arrancar. Con `META_APP_SECRET` vacío la firma
  HMAC usa clave vacía (`channels/meta.py:77-80`): cualquiera inyecta
  mensajes en cualquier inbox, gasta LLM y hace que el número del cliente
  responda. Con `JWT_SECRET` vacío se firman tokens de superadmin (los UUID
  de usuario son visibles para cualquier miembro). Con `ENCRYPTION_KEY`
  vacío la app arranca y falla recién en cada mensaje. **Arreglo:**
  validadores de pydantic-settings que aborten el arranque (JWT ≥32
  caracteres, Fernet válida, secretos de Meta no vacíos, rechazar valores de
  ejemplo); `verify_signature` devuelve `False` si no hay secreto.
- **S-C2 · Tool SQL lee la base central.** `custom_tools/sql_tool.py:44-54`
  solo valida el esquema `postgres://`, no el host. Un admin de cualquier
  cuenta crea una tool contra `postgresql://telar:telar@db:5432/telar` y lee
  `users`, `messages`, `contacts` de todas las cuentas; como `telar` es
  superusuario, `pg_read_file()` también funciona. **Arreglo:** resolver el
  host y aplicar el mismo bloqueo de IPs privadas/loopback de la tool HTTP,
  prohibir `db`/`localhost`/sockets, conectar a la IP validada; usuario de
  aplicación sin superusuario.
- **S-C3 · Robo de API keys de la plataforma.** `agent/graph_cache.py:67-74`,
  `llm/router.py:98-99`: sin `api_key` propia, LangChain toma
  `OPENAI_API_KEY`/`ANTHROPIC_API_KEY` del entorno; con `base_url` apuntando
  al atacante, la key viaja en el header. **Arreglo:** `base_url` propio
  exige `api_key` propia; nunca heredar keys del entorno para cuentas.

**Altos**

- **S-A1 · IDOR en miembros de equipos.** `accounts/router.py:250-282`: usa
  `team_id` sin comprobar que sea de la cuenta. Un supervisor de A lista,
  agrega o saca gente de equipos de B (necesita el UUID). **Arreglo:**
  `_get_team_or_404(account_id, team_id)` y validar que el usuario sea
  miembro.
- **S-A2 · Supervisor degrada administradores.** `accounts/router.py:135-153`
  + `ON CONFLICT … DO UPDATE SET role` en `repositories/accounts.py:83`: un
  supervisor "suma" al admin como `agent` y lo degrada; la cuenta puede
  quedar sin administradores. **Arreglo:** mirar el rol actual del destino,
  chequear el último admin, separar "sumar" de "cambiar rol".
- **S-A3 · SSRF por DNS rebinding en tool HTTP.** `custom_tools/http_tool.py:83-89`:
  se valida la IP y después httpx resuelve de nuevo. Con TTL 0 se llega a
  `169.254.169.254` (credenciales de la nube). **Arreglo:** conectar a la IP
  ya validada o salir por un proxy de egress; bloquear `100.64.0.0/10`;
  `trust_env=False`.
- **S-A4 · Inbox sin token usa el token global de Meta.** `inboxes/router.py:81,112`,
  `channels/meta.py:228-229,391-394`: `access_token` vacío cae a
  `META_ACCESS_TOKEN`; con eso una cuenta envía desde números ajenos.
  Relacionado: cualquiera registra primero el `phone_number_id` de otro y se
  queda con sus mensajes. **Arreglo:** token obligatorio, validado contra
  `GET /{phone_number_id}` de Meta antes de guardar; sin fallback global en
  multi-cuenta.
- **S-A5 · Webhook con varios números se enruta al primero** (PLAUSIBLE).
  `api/main.py:80-110`: si Meta junta cambios de dos números en un POST,
  todos se atribuyen al primer inbox y el bot equivocado responde.
  **Arreglo:** resolver el inbox por cada `change`.

**Medios**

- **S-M1 · Prueba de base externa escanea la red interna.**
  `tenant_db/router.py:78-91` acepta cualquier host y devuelve el error
  crudo; `/provision` corre DDL contra ese host. Mismo filtro que S-C2 y
  errores genéricos.
- **S-M2 · Rate limit de login global detrás del túnel.** `auth/router.py:59`:
  detrás de cloudflared todos comparten IP; 5 intentos fallidos bloquean el
  login de toda la plataforma 15 min. `--forwarded-allow-ips` con la IP del
  proxy, `CF-Connecting-IP`, y límite también por email.
- **S-M3 · Cambio de contraseña débil.** `auth/router.py:98-109`: sin largo
  mínimo, sin rate limit, no invalida JWT ya emitidos (24 h). Agregar
  `token_version` en `users`.
- **S-M4 · Subida a base de conocimiento sin límite.** `kb/router.py:84` lee
  el archivo entero en memoria y lo vectoriza con la key de la plataforma.
  Tope de bytes y de fragmentos por cuenta.
- **S-M5 · Prompt injection dentro de la cuenta.** Los argumentos de las
  tools los decide el LLM: un contacto pide "el pedido 1002" y ve el de otro
  cliente del negocio. Inyectar el `wa_id` del contacto como parámetro fijo
  de la tool, que el LLM no pueda cambiar.
- **S-M6 · Media servida sin `nosniff` ni `Content-Disposition`**
  (PLAUSIBLE). `conversations/router.py:447-450` + el frontend abre blobs en
  pestaña nueva con el origen del panel: un SVG con script mandado por un
  contacto podría leer el token del asesor. Lista blanca de MIME y descargar
  en vez de abrir (ver F-A5).

**Bajos:** `Content-Length` no numérico da 500 y con `chunked` no hay tope
(`api/main.py:62-66`); `assignee_id`/`team_id`/`default_team_id` aceptan
UUIDs de otras cuentas; `update_message_delivery_status` sin filtro de
tenant; `verify_token` comparado con `==`; `/docs` público en producción;
`bcrypt ≥5` rompe con contraseñas de más de 72 bytes; el log de auditoría no
registra cambios de rol.

### 4.2 Confiabilidad (backend)

**Críticos**

- **R-C1 · Un turno fallido no se responde nunca.** `worker/pipeline.py:87,94-108`,
  `worker/dispatcher.py:96-104`: el mensaje se guarda antes de llamar al LLM;
  si algo falla después (LLM caído, timeout del pool, grafo roto, respuesta
  no-JSON de Meta), en el reintento `save_inbound` devuelve `None`, el lote
  se da por procesado y se borra. Además el reintento solo ocurre si el
  contacto vuelve a escribir o el proceso reinicia. **Arreglo:** marcar el
  mensaje como "turno procesado" aparte de "guardado", reintento con backoff
  y tope, y al agotarlo pasar a `pending` con aviso.
- **R-C2 · El pipeline escribe con estado viejo.** `worker/pipeline.py:60-137`,
  `repositories/conversations.py:187-205`: lee la conversación, descarga
  media (hasta 30 s) o espera al LLM (hasta 20 s), y después guarda el objeto
  viejo con un `UPDATE` sin condición. Si un asesor la tomó mientras tanto,
  vuelve a `bot` y el bot responde; si el bot escaló, borra al asesor.
  `resolve` y `release` tienen el mismo problema. **Arreglo:** updates
  atómicos y condicionales, releer el estado justo antes de enviar.

**Altos**

- **R-A1 · Envío a Meta sin reintentos** (punto 8 de la sección 2); además
  `resp.json()` sobre un error no-JSON lanza excepción y cae en R-C1.
- **R-A2 · `memory_window` corta pares tool-call/resultado.**
  `agent/compiler.py:158-160`: el historial puede empezar en un
  `ToolMessage` huérfano y Anthropic/OpenAI devuelven 400 en todos los turnos
  siguientes. Con `memory_window=0` el modelo no ve nada. Recortar desde un
  mensaje humano; exigir ≥1.
- **R-A3 · Historial y checkpoints crecen sin límite.** El grafo por defecto
  manda todo el hilo en cada turno (costo creciente y, al final, exceso de
  contexto = falla permanente). Los checkpoints nunca se podan.
  `memory_window` por defecto (~30), borrar el hilo al resolver, tarea de
  limpieza.
- **R-A4 · Sin sistema de migraciones** (punto 7 de la sección 2). Los
  archivos 002–009 tampoco son re-ejecutables.
- **R-A5 · Estado de entrega hace un scan completo de `messages`.**
  `repositories/conversations.py:300-309` filtra sin `inbox_id` y el índice
  no aplica; son ~3 webhooks por cada mensaje enviado. Pasar `inbox_id`.
- **R-A6 · Límite de 64 KB rechaza webhooks legítimos.** Meta documenta
  hasta 3 MB; un 413 hace que Meta reintente hasta descartar, y con eso se
  pierden mensajes. Subir a ~3 MB y dejar el límite fino al proxy.
- **R-A7 · Varias réplicas rompen el orden por contacto.** El lock y los
  timers viven en memoria (`dispatcher.py:35-36,90`); con 2 procesos, dos
  respuestas en paralelo sobre el mismo hilo. `pg_advisory_xact_lock` por
  contacto o reclamar filas con `SKIP LOCKED`. Solo urgente al escalar.

**Medios**

- **R-M1** `drain()` no espera los lotes en curso al apagar.
- **R-M2** Un lote que siempre falla queda en el buffer para siempre y se
  reprocesa con cada mensaje nuevo. Contador de intentos y cola de muertos.
- **R-M3** Validación del grafo con huecos: campos faltantes dan 500, se
  aceptan **ciclos** (fallan en cada mensaje), nombres reservados, tipos sin
  validar. Modelo Pydantic del grafo.
- **R-M4** Si Anthropic devuelve varios bloques, al cliente le llega
  `[{'type': 'text', ...}]` literal (`pipeline.py:123-124`).
- **R-M5** Detección del traspaso frágil: mira solo los últimos 3 mensajes
  (`pipeline.py:132-135`).
- **R-M6** `pending` es un callejón sin salida: nada lo devuelve a `bot` si
  nadie la toma. Y "resolved se reabre en bot" es código muerto: se crea una
  conversación nueva sin memoria.
- **R-M7** Carrera en `get_or_create_conversation` (SELECT + INSERT sin
  `ON CONFLICT`).
- **R-M8** Pool fijo en 10 con 20 invocaciones concurrentes permitidas;
  sin chequeo de conexiones muertas; `setup()` del checkpointer sin lock.
- **R-M9** Sin timeouts: el SDK del LLM espera hasta 600 s y la tool SQL no
  fija `statement_timeout`.
- **R-M10** `bcrypt` y `getaddrinfo` bloquean el event loop (~250 ms por
  login, frenando también al webhook).
- **R-M11** Búsqueda en base de conocimiento: HNSW trae candidatos globales
  y filtra después por cuenta; con muchas cuentas, una puede recibir 0
  resultados aunque tenga contenido.
- **R-M12** Falta índice `conversations (account_id, last_contact_message_at DESC)`
  para la bandeja.
- **R-M13** `deploy_bot.py` no invalida la caché de grafos; nada garantiza
  un bot por cuenta.
- **R-M14** Sacar a un miembro deja sus conversaciones `open` retenidas para
  siempre, con el bot callado.
- **R-M15** `/health` no consulta la base; los errores de Meta descartan el
  código; sin métricas del LLM.

**Bajos:** `rate_limit_counters` y los locks por contacto nunca se limpian;
operaciones de varios pasos sin transacción (`save_bot`, `create_account`);
estados de entrega fuera de orden pisan `read` con `delivered`; un
`httpx.AsyncClient` nuevo por cada llamada a Meta; código muerto en
`core/types.py`; duplicación en `save_inbound`/`save_inbound_rate_limited`;
faltan `CHECK` y FKs; un álbum de 11 fotos choca con el rate limit de 10.

**Tests:** hay ~28, y cubren el camino feliz. Falta todo lo que habría
detectado los críticos: máquina de estados (`core/state.py`, cero tests),
guarda del traspaso, fallo del LLM/envío, parseo y firma de Meta, ventana de
24 h, permisos por rol y 404 entre cuentas. Los tests de integración no
corren en ningún CI.

### 4.3 Frontend

**Altos**

- **F-A1 · Un 401 no cierra la sesión.** `lib/api.ts:60-63`, `lib/auth.tsx:49-52`:
  el token se borra pero la interfaz sigue mostrando datos viejos y tirando
  toasts cada 5–8 s. `logout()` no limpia la caché: el siguiente usuario en
  la misma pestaña ve un instante los datos del anterior.
- **F-A2 · Login con contraseña incorrecta dice "No autenticado"** en vez de
  "Credenciales inválidas" (`lib/api.ts:60`).
- **F-A3 · Hueco de mensajes en el hilo tras "Cargar anteriores".**
  `routes/ThreadPage.tsx:74-141`: al llegar mensajes nuevos, los del medio
  desaparecen de la vista; y con historial viejo cargado el polling se apaga.
- **F-A4 · `memory_window` vacío guarda 0** (`flow/NodeEditPanel.tsx:115-119`)
  y el bot queda sin contexto (ver R-A2).
- **F-A5 · Sin CSP ni headers de seguridad** (no hay `public/_headers`); con
  el JWT en `localStorage`, cualquier XSS es tomar la cuenta. Sumado a S-M6.

**Medios**

- **F-M1** Ninguna lista distingue "error" de "vacío": si el backend falla
  se ve "No hay conversaciones". En el constructor, un error de carga deja
  un lienzo vacío que se puede guardar.
- **F-M2** El constructor pierde en silencio los nodos no conectados al
  recargar, y el siguiente guardado los borra (`lib/flowGraph.ts:36-48`).
- **F-M3** Borrar con el teclado en el lienzo no marca "sin guardar"; no hay
  aviso al salir con cambios pendientes.
- **F-M4** Paginación por offset con orden cambiante duplica o salta
  conversaciones.
- **F-M5** Contactos solo enlaza a conversaciones de las primeras 50.
- **F-M6** Polling: ~0,7 req/s por asesor (stats 8 s ×2, lista 8 s, hilo
  5 s, alerta de título 8 s también en segundo plano).
- **F-M7** La media de un hilo se descarga toda al abrirlo y nunca se libera
  de memoria.
- **F-M8** No hay pantalla para cambiar la contraseña, aunque el endpoint
  existe: quien recibe una temporal se queda con ella.
- **F-M9** Un solo bundle de 931 KB: el constructor de flujos se descarga
  para todos los asesores aunque solo lo usan admins. `React.lazy` en
  `BotFlowPage` y `SettingsPage`.
- **F-M10** Mutaciones que no refrescan lo que deberían (miembros de
  equipos, herramientas disponibles, base externa).
- **F-M11** El drawer mobile no es un diálogo accesible (sin foco atrapado
  ni `role="dialog"`) — `components/ui/sidebar.tsx`.

**Bajos:** errores 422 muestran `[object Object]`; la cuenta regresiva de
24 h no avanza con el hilo abierto; el diálogo de tools precarga
`"Bearer TU_TOKEN_AQUI"` como valor real; roles congelados hasta recargar;
`/bot` accesible por URL para asesores (solo UX, el backend lo bloquea);
horas de los mensajes solo con hover; contraste bajo en textos de 10–11 px;
sin `VITE_API_URL` el build de producción apunta a `localhost` sin avisar.

**Mantenibilidad:** 10 archivos de más de 300 líneas (`BotFlowPage.tsx` 571,
`endpoints.ts` 495, `ThreadPage.tsx` 489…); código muerto confirmado
(`ui/card.tsx`, `ui/separator.tsx`, `getSetup`, `graphToSteps`,
`stepsToGraph`, `relativeTime`, `assets/vite.svg`); ~6 diálogos de
confirmación casi idénticos; cero tests.

### 4.4 Infraestructura

**Críticos**

- **I-C1 · Migraciones solo en la primera creación** = R-A4.
- **I-C2 · Postgres publicado en `0.0.0.0` con `telar/telar`** = punto 2 de
  la sección 2. Además `DATABASE_URL` fijo en el compose pisa el del `.env`
  e impide usar un Postgres gestionado.
- **I-C3 · Secretos vacíos aceptados** = S-C1.

**Altos**

- **I-A1 · Sin lockfile de Python.** Todo `>=` sin techo: cada build baja
  versiones distintas de langchain/langgraph. `uv lock` + `uv sync --frozen`.
- **I-A2 · Sin TLS ni reverse proxy**; la API publicada en HTTP en
  `0.0.0.0:8000`. Caddy o solo cloudflared, sin `ports` en `api`.
- **I-A3 · Sin backups ni restore probado** de Postgres ni de la media.
- **I-A4 · Sin CI/CD, staging ni despliegue sin caída.** No existe
  `.github/`; el deploy es `compose up --build` en el servidor.
- **I-A5 · Varias réplicas** = R-A7.

**Medios:** el Dockerfile reinstala todas las dependencias con cada cambio de
código (orden de capas); sin `HEALTHCHECK` ni apagado ordenado; imagen base
sin fijar y desarrollo en Python 3.14 contra 3.12 en producción; la imagen
no trae el extra `mysql` aunque la interfaz lo ofrece; sin logs
estructurados, métricas ni alertas (y se loguean 200 bytes del body crudo,
que pueden tener teléfonos); logs de Docker sin rotación; media en disco
local; CORS con un solo origen; `cloudflared:latest` sin versión.

**Bajos:** frontend sin `engines`/`.nvmrc`; ~~íconos duplicados entre
`brand/` y `frontend/public/`~~ (resuelto: `brand/` se limpió); **licencia MIT** mientras el objetivo es venderlo como
producto — decisión de negocio pendiente (MIT, AGPL, open-core).

---

## 5. Lo que está bien hecho

Para ser justos, y porque es lo que vende:

- **Aislamiento entre cuentas en los endpoints principales**: cada router
  valida con `_get_X_or_404` que la entidad sea de la cuenta; los listados
  filtran por `account_id` en SQL; `require_role` relee al usuario en cada
  request (revocación inmediata).
- **Webhook sólido**: firma validada antes de parsear y en tiempo constante,
  responde 200 incluso ante JSON inválido, deduplicación en tres capas,
  buffer persistido en Postgres con recuperación al arrancar.
- **Traspaso a humano como máquina de estados** separada del LLM; `assign`
  con concurrencia optimista.
- **Secretos cifrados con Fernet** (tokens de Meta, API keys, credenciales)
  y ningún endpoint los devuelve.
- **Tool SQL de solo lectura impuesta por el motor**, consultas
  parametrizadas en todo el código, guarda contra SSRF en la tool HTTP, sin
  path traversal en media.
- **JWT con algoritmo fijo**, bcrypt, y login que no revela qué emails
  existen.
- **Caché de grafos versionada entre procesos** y rate limit atómico: la
  base para escalar ya está.
- **Frontend**: sin `dangerouslySetInnerHTML`, media por endpoint
  autenticado, guards de rol alineados con el backend, diálogos accesibles
  de Radix, TypeScript compila limpio.
- **Docker**: usuario no-root, `COPY` selectivo (el `.env` no entra en la
  imagen), nombre de proyecto fijo.

---

## 6. Documentación desactualizada

Los README decían cosas que ya no son ciertas. Se corrigieron en la
reorganización de los README (ver el propio README); se deja la lista como
registro:

- "El agrupamiento de ráfagas vive en memoria" → vive en Postgres desde la
  migración 006.
- "Los tokens de Meta se leen del entorno; Fernet no implementado" → están
  cifrados y se descifran por inbox.
- "No hay API de administración; cuentas, inboxes, tools y bases de
  conocimiento se crean con INSERT a mano" → existe la API completa y el
  panel.
- "Si editás una tool hay que reiniciar el proceso" → la caché se invalida
  sola.
- "Resolved: el siguiente mensaje la reabre en bot" → se crea una
  conversación nueva (ver R-M6).
- "El supervisor no puede sumar ni sacar miembros" → puede sumar y sacar
  asesores.
- "Si falta `system_prompt` usa el de la cuenta" → usa el global.
- Quickstart con `docker compose` en la raíz, perfil `dev` en vez de
  `tunnel`, y la tabla de variables incompleta.
- Sigue siendo cierto: no hay reintentos en el envío a Meta (R-A1).

---

## 7. Pendientes heredados de notas anteriores

De `MEJORAS_PROPUESTAS.md` y `PLAN_ESCALABILIDAD.md` (2026-09-04 y
2026-09-09), lo que sigue vigente y no está arriba:

- **Clave de cifrado por cuenta.** Una sola `ENCRYPTION_KEY`
  (`core/crypto.py`) cifra los secretos de todos los clientes: si se filtra,
  caen todos. Antes del primer cliente pagando: envelope encryption con
  clave derivada por cuenta, o al menos un plan de rotación. Grande; conviene
  diseñarlo antes de tener muchos datos cifrados.
- **Aviso de sesión por expirar / refresh.** No existe `POST /auth/refresh`;
  el JWT dura 24 h. Mínimo: avisar antes del `exp` con link a volver a
  entrar. Completo: endpoint de refresh.
- **Semáforo del LLM por cuenta** (`worker/pipeline.py:33`): hoy es global;
  un cliente grande frena a los chicos.
- **Índice `pg_trgm`** para las búsquedas `ILIKE` de contactos: solo cuando
  la tabla crezca.
- **Uvicorn sin `--workers`** y pool de 10 conexiones: ajustar junto con la
  fase 4.
