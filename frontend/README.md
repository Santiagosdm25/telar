# Telar -- frontend

Panel de administración (React 19 + TypeScript + Vite + Tailwind v4). Habla
con el backend (`../backend/`) exclusivamente por HTTP, vía `VITE_API_URL`.

## Desarrollo

```bash
npm install
npm run dev
```

Sin `VITE_API_URL` en el entorno, apunta a `http://localhost:8000` (ver
`src/lib/api.ts`) -- alcanza para desarrollar contra el backend local.

## Deploy a Cloudflare Pages

Es un build estático (`vite build` genera `dist/`), no necesita Docker ni
un proceso corriendo -- encaja directo con Cloudflare Pages, plan gratis.

1. En el dashboard de Cloudflare: **Workers & Pages -> Create -> Pages ->
   Connect to Git**, elegí este repo.
2. **Root directory**: `frontend` (el repo tiene el backend al lado, en
   `backend/`).
3. **Build command**: `npm run build`
4. **Build output directory**: `dist`
5. Variable de entorno de build: `VITE_API_URL` = la URL pública del
   backend (por ejemplo `https://api.tudominio.com`) -- sin esto el panel
   desplegado sigue apuntando a `localhost:8000` y no va a poder loguear.
6. Deploy. Cloudflare te da un dominio `*.pages.dev`; para uno propio,
   `Custom domains` en el mismo proyecto.

El archivo `public/_redirects` (`/* /index.html 200`) ya está para que las
rutas de React Router (`/accounts/:id/...`) no den 404 al recargar la
página o entrar por link directo -- Cloudflare Pages lo lee solo, sin
configuración adicional.

Después de desplegar, en el backend (`backend/.env`) `FRONTEND_ORIGIN` tiene
que ser exactamente ese dominio (CORS acepta un solo origin, no `*`) --
ver `backend/.env.example`.
