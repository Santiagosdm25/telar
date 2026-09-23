<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="brand/telar-horizontal-dark.svg" />
    <source media="(prefers-color-scheme: light)" srcset="brand/telar-horizontal-light.svg" />
    <img src="brand/telar-horizontal-light.svg" alt="Telar" width="280" />
  </picture>
</p>

Plataforma open source para construir agentes conversacionales sobre WhatsApp Cloud API.

Telar recibe los mensajes de Meta, los pasa por un agente construido con LangGraph y devuelve la respuesta. Cuando el agente detecta que el caso necesita una persona, suelta la conversación y no vuelve a hablar hasta que el asesor la cierre.

Está pensado para quien ya tiene un número aprobado en Meta y quiere operarlo con sus propios modelos, su propia base de datos y su propio servidor.

> **Estado:** funciona el ciclo completo — webhook, agente, traspaso a humano, bandeja de entrada, cuentas y roles, bases de conocimiento, herramientas propias y constructor visual de flujos. **Todavía no está listo para producción con clientes externos**: ver [`docs/AUDITORIA.md`](docs/AUDITORIA.md) para lo que falta y en qué orden.

## Por qué existe

Hoy la opción es armar el flujo en una herramienta no-code que cobra por conversación, o programar cada bot desde cero contra la API de Meta. Telar es la capa intermedia: la fontanería difícil resuelta, y el agente definido por ti.

Lo que ya está resuelto y suele salir mal cuando se hace a mano:

- El webhook responde `200` de inmediato y procesa aparte. Si tardas, Meta reintenta y el bot contesta dos veces.
- Deduplicación por `message.id` con índice único en base de datos.
- Validación de la firma `X-Hub-Signature-256`.
- Agrupación de ráfagas: la gente manda tres mensajes seguidos y el agente los ve como un turno. El buffer vive en Postgres, así que sobrevive a un reinicio.
- Orden garantizado por contacto. Dos ráfagas no se cruzan.
- La ventana de servicio de 24 horas se verifica antes de enviar.
- El traspaso a humano es una máquina de estados explícita, no una improvisación dentro del prompt.

## Cómo funciona

```
Meta Cloud API
      │  webhook
      ▼
API de ingesta ......... valida firma, deduplica, responde 200
      │
      ▼
Dispatcher ............. agrupa la ráfaga, garantiza orden por contacto
      │
      ▼
Pipeline ............... ¿la conversación es del bot o de un humano?
      │
      ▼
Agente LangGraph ....... modelo + herramientas + memoria en Postgres
      │
      ▼
Adaptador de canal ..... traduce y envía
```

La regla que sostiene el diseño: **ni el agente ni la lógica de negocio ven un payload de Meta.** Todo entra como `InboundMessage` y sale como `OutboundMessage`. Agregar Telegram o webchat es escribir un adaptador nuevo, no tocar el agente.

## Estructura del repo

```
backend/     API, webhook, agente y base de datos (Python · FastAPI · LangGraph · Postgres)
frontend/    Panel web: bandeja, contactos, equipo, configuración, constructor de flujos (React · Vite)
brand/       Logo del README y reglas de uso de la marca
deploy/      Compose de producción (API + túnel, base externa)
docs/        Auditoría y guía de despliegue
Makefile     Atajos de desarrollo (delegan en backend/Makefile)
```

El backend y el frontend son independientes: el panel habla con la API solo por HTTP (`VITE_API_URL`) y se despliega aparte como sitio estático.

| Parte | Documentación |
|---|---|
| Backend | [`backend/README.md`](backend/README.md) — configuración, variables, traspaso, bases de conocimiento, herramientas, roles, compilador de grafos |
| Frontend | [`frontend/README.md`](frontend/README.md) — desarrollo y despliegue en Cloudflare Pages |
| Marca | [`brand/README.md`](brand/README.md) |
| Salir a producción | [`docs/DEPLOY.md`](docs/DEPLOY.md) — Supabase o Postgres propio, VPS, Cloudflare Tunnel y Pages |
| Estado y pendientes | [`docs/AUDITORIA.md`](docs/AUDITORIA.md) |

## Arranque rápido (desarrollo)

Necesitas Docker, Node 20+, un número de WhatsApp aprobado en Meta y una clave de algún proveedor de modelos.

```bash
git clone https://github.com/<tu-usuario>/telar.git
cd telar
cp backend/.env.example backend/.env
```

Llena `backend/.env`: como mínimo `META_APP_SECRET`, `META_VERIFY_TOKEN`, `ENCRYPTION_KEY`, `JWT_SECRET` y la clave de tu proveedor de modelos. El archivo trae los comandos para generar las claves.

```bash
make up                                          # base de datos + API en :8000
make superadmin EMAIL=vos@empresa.com NAME="Tu Nombre"
```

Y en otra terminal, el panel:

```bash
cd frontend && npm install && npm run dev        # http://localhost:5173
```

Entra con el usuario que creaste, crea una cuenta y conecta tu número desde **Configuración → Inboxes**. `make help` lista el resto de los atajos.

Para que Meta llegue al webhook hace falta una URL pública con HTTPS: ver *Exponer el webhook* en [`backend/README.md`](backend/README.md#exponer-el-webhook). Para un servidor de verdad, [`docs/DEPLOY.md`](docs/DEPLOY.md).

## Licencia

MIT — ver [`LICENSE`](LICENSE).

Telar no está afiliado con Meta Platforms. WhatsApp es una marca registrada de Meta Platforms, Inc.
