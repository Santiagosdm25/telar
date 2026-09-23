# Salir a producción

Cómo dejar Telar corriendo en un servidor propio. El resultado:

```
Panel (frontend)  →  Cloudflare Pages          https://panel.tudominio.com
API + webhook     →  tu VPS, en Docker          https://api.tudominio.com
HTTPS             →  Cloudflare Tunnel          (sin abrir puertos ni certificados)
Base de datos     →  Supabase o Postgres propio (DATABASE_URL)
```

En el servidor todo se reduce a llenar `backend/.env` y correr `make deploy`.

> **Antes del primer cliente externo**, revisá [`AUDITORIA.md`](AUDITORIA.md): esta guía deja la infraestructura bien armada, pero quedan agujeros en el código (tool SQL, `base_url` del LLM, mensajes que se pierden si el LLM falla) que conviene cerrar antes de dejar que un tercero administre su cuenta.

---

## 0. Qué necesitás

- **Un VPS** con Ubuntu 22.04/24.04, 2 vCPU y 4 GB de RAM (Hetzner, DigitalOcean, Vultr, Lightsail: ~USD 6–12/mes). No hace falta IP fija ni abrir puertos.
- **Un dominio en Cloudflare** (plan gratis). Si tu dominio está en otro lado, cambiá sus nameservers a Cloudflare.
- **La base de datos**: un proyecto de Supabase, o cualquier Postgres 16 con la extensión `vector` (pgvector).
- **Tu app de Meta** con el número de WhatsApp aprobado, y una clave de tu proveedor de modelos (Anthropic u OpenAI).

---

## 1. Base de datos

### Opción A — Supabase

1. Creá un proyecto en [supabase.com](https://supabase.com). Elegí la región más cercana a tu VPS y **guardá la contraseña de la base** (no se vuelve a mostrar).
2. En el proyecto: **Connect** (arriba) → **Connection string** → **Session pooler**. Copiá la cadena y reemplazá `[YOUR-PASSWORD]`. Agregale `?sslmode=require` al final:
   ```
   postgresql://postgres.<ref>:<password>@aws-0-<región>.pooler.supabase.com:5432/postgres?sslmode=require
   ```
   - Usá el **Session pooler** (puerto 5432): funciona desde cualquier VPS.
   - La conexión directa (`db.<ref>.supabase.co`) en el plan gratis es solo IPv6, y muchos VPS no la tienen.
3. No hace falta crear tablas ni activar extensiones a mano: `make deploy` aplica las migraciones.

**Plan:** el gratis sirve para probar, pero se pausa tras 7 días sin actividad, tiene 500 MB y no trae backups. Para clientes reales, **Pro** (USD 25/mes: backups diarios, 8 GB).

**Regla para no quedar atado a Supabase:** usalo solo como Postgres. Nada de Supabase Auth, Edge Functions ni tablas o políticas creadas desde su panel: todo el esquema vive en `backend/migrations/`. Así, mudarse es un `pg_dump` (ver sección 8).

### Opción B — Postgres propio

Cualquier Postgres 16 con pgvector (imagen `pgvector/pgvector:pg16`, RDS, Cloud SQL, Neon…). Creá una base y un usuario **que no sea superusuario**, con permisos sobre esa base, y usá:
```
postgresql://usuario:password@host:5432/telar
```
Si Postgres corre en el mismo VPS, **no publiques su puerto a internet**.

---

## 2. Túnel de Cloudflare (HTTPS)

1. En [one.dash.cloudflare.com](https://one.dash.cloudflare.com): **Networks → Tunnels → Create a tunnel** → tipo **Cloudflared** → ponele un nombre (`telar`).
2. En la pantalla de instalación, copiá **solo el token** (la cadena larga después de `--token`). No instales nada: el compose ya trae cloudflared.
3. En **Public Hostname** agregá:
   - Subdominio `api`, dominio `tudominio.com`
   - Service: **HTTP** → `api:8000`

---

## 3. Servidor

Instalar Docker y bajar el proyecto:

```bash
curl -fsSL https://get.docker.com | sh
sudo usermod -aG docker $USER   # y volvé a entrar por SSH
git clone https://github.com/<tu-usuario>/telar.git
cd telar
cp backend/.env.example backend/.env
chmod 600 backend/.env
```

Llená `backend/.env`. Lo mínimo:

| Variable | Valor |
|---|---|
| `DATABASE_URL` | La cadena del paso 1 |
| `META_APP_SECRET` | Meta for Developers → tu app → Configuración → Básica → Clave secreta |
| `META_VERIFY_TOKEN` | Una cadena aleatoria que inventás (la vas a pegar en Meta en el paso 6) |
| `ENCRYPTION_KEY` | `openssl rand -base64 32 \| tr '+/' '-_'` (clave Fernet) |
| `JWT_SECRET` | `openssl rand -base64 48` |
| `FRONTEND_ORIGIN` | `https://panel.tudominio.com` (exacto, sin `/` al final) |
| `ANTHROPIC_API_KEY` / `OPENAI_API_KEY` | La de tu proveedor. `OPENAI_API_KEY` también la usan las bases de conocimiento |
| `CLOUDFLARE_TUNNEL_TOKEN` | El token del paso 2 |

> **Guardá `ENCRYPTION_KEY` en un lugar seguro, fuera del servidor.** Cifra los tokens de Meta y las API keys guardadas en la base: si la perdés, esos datos no se pueden recuperar.

`ENV` no hace falta tocarlo: el compose de producción lo fuerza a `production`, y en ese modo **la API se niega a arrancar** si falta un secreto, si quedó un valor de ejemplo o si `DATABASE_URL` tiene las credenciales de desarrollo. El error dice qué variable corregir.

---

## 4. Levantar

```bash
make deploy
make prod-status
```

`make deploy` construye la imagen, aplica las migraciones pendientes (si alguna falla, la API no arranca), levanta la API y el túnel. `make prod-status` tiene que mostrar `{"status":"ok"}`, que significa que la API responde **y** llega a la base.

Desde tu computadora, `https://api.tudominio.com/health` tiene que dar lo mismo.

Primer usuario (pide la contraseña por consola):

```bash
make prod-superadmin EMAIL=vos@tudominio.com NAME="Tu Nombre"
```

---

## 5. Panel (Cloudflare Pages)

1. Cloudflare → **Workers & Pages → Create → Pages → Connect to Git** → elegí el repo.
2. Configuración del build:
   - **Root directory:** `frontend`
   - **Build command:** `npm run build`
   - **Build output directory:** `dist`
   - **Variable de entorno:** `VITE_API_URL` = `https://api.tudominio.com` (sin `/` al final)
3. En **Custom domains** agregá `panel.tudominio.com`. Tiene que coincidir exacto con `FRONTEND_ORIGIN`; si lo cambiás, editá `backend/.env` y corré `make deploy` de nuevo.

Entrá a `https://panel.tudominio.com` con el superadmin, creá la cuenta del cliente y conectá su número en **Configuración → Inboxes**.

---

## 6. Webhook de Meta

Meta for Developers → tu app → WhatsApp → **Configuración**:

- **URL de devolución de llamada:** `https://api.tudominio.com/webhooks/whatsapp`
- **Token de verificación:** el mismo `META_VERIFY_TOKEN`
- Suscribite al campo **`messages`**.

Escribile al número: tiene que aparecer en la bandeja y el bot tiene que responder.

---

## 7. Operación diaria

| Qué | Comando |
|---|---|
| Actualizar a la última versión | `git pull && make deploy` (migra solo; unos segundos de corte) |
| Ver logs | `make prod-logs` (o `SERVICE=api`, `SERVICE=migrate`, `SERVICE=tunnel`) |
| Estado y salud | `make prod-status` |
| Migraciones aplicadas / pendientes | `make prod-migrate-status` |
| Resetear una contraseña | `make prod-password EMAIL=...` |
| Apagar | `make prod-down` (los datos viven en la base; la media en el volumen `telar-prod_telar_media`) |

Los logs de Docker rotan solos (5 archivos de 10 MB por servicio).

### Backups

- **Base:** Supabase Pro hace backups diarios. Con Postgres propio, o además de Supabase, un dump programado:
  ```bash
  pg_dump "$DATABASE_URL" -Fc --no-owner --no-acl -f telar-$(date +%F).dump
  ```
  Guardalo fuera del servidor (S3, R2, Backblaze). Probá restaurarlo alguna vez: un backup que nunca se restauró no es un backup.
- **Media** (fotos, audios y documentos de los chats): viven en el volumen de Docker `telar-prod_telar_media` del VPS, no en la base. Copialo con el mismo criterio.
- **`backend/.env`**, sobre todo `ENCRYPTION_KEY`.

---

## 8. Cambiar de base de datos

Telar usa Postgres estándar, sin nada propio de Supabase. Para mudarse (Supabase → Postgres propio, o al revés):

```bash
make prod-down
pg_dump "postgresql://...origen..." -Fc --no-owner --no-acl -f telar.dump
pg_restore -d "postgresql://...destino..." --no-owner --no-acl telar.dump
```

Cambiá `DATABASE_URL` en `backend/.env` y corré `make deploy`.

---

## Problemas comunes

| Síntoma | Causa probable |
|---|---|
| `make deploy` termina con `Configuración inválida` | Falta una variable o quedó un valor de ejemplo; el mensaje dice cuál |
| La API no arranca y `SERVICE=migrate` muestra un error | Una migración falló; no se aplicó a medias. Revisá el mensaje y `DATABASE_URL` |
| `/health` da 503 | La API no llega a la base: `DATABASE_URL`, contraseña, `?sslmode=require`, o el proyecto de Supabase está pausado |
| El panel dice que no puede conectar / error de CORS en la consola | `FRONTEND_ORIGIN` no coincide exacto con el dominio del panel, o `VITE_API_URL` está mal |
| Meta no valida el webhook | `META_VERIFY_TOKEN` distinto al de Meta, o el túnel no apunta a `api:8000` |
| Llegan mensajes pero no aparecen | `META_APP_SECRET` incorrecto: la firma no valida y se descartan (se ve en `make prod-logs`) |
| "Demasiados intentos" en el login | 5 intentos fallidos desde la misma IP en 15 minutos; esperar |

## Qué no cubre todavía

- **Una sola réplica de la API.** Para correr varias hace falta primero el lock por contacto en Postgres y la media en S3/R2 (auditoría, R-A7 e I-M8).
- **Sin CI ni staging:** `git pull && make deploy` va directo a producción. Probá antes en tu máquina con `make up`.
- **Sin monitoreo ni alertas.** Mínimo recomendado: un chequeo externo gratuito (UptimeRobot, Better Stack) contra `https://api.tudominio.com/health`.
