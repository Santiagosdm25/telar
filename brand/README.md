# Telar — marca

Todo trazado a curvas: ningún archivo depende de que haya una fuente instalada.

## Dónde vive cada cosa

| Uso | Archivo |
|---|---|
| Logo en la app (icono + lockups, en código) | `frontend/src/components/Logo.tsx` — **la fuente de verdad** |
| Favicon e íconos de PWA | `frontend/public/favicon.png`, `icon-192.png`, `icon-512.png`, `apple-touch-icon.png` |
| Manifest | `frontend/public/site.webmanifest` |
| Colores y tipografía de la UI | `frontend/src/index.css` |
| Header del README | `brand/telar-horizontal-light.svg` / `-dark.svg` |

Los dos SVG de esta carpeta son el mismo lockup horizontal con color fijo, para Markdown/GitHub, donde no hay CSS del que heredar el color. Las versiones anteriores del set (brandsheet, variantes mono/vertical, tokens de referencia) se sacaron el 2026-09-23 porque nada las usaba; siguen en el historial de git.

## Componente

```tsx
import { Logo } from '@/components/Logo'

<Logo variant="horizontal" size={32} />        // header
<Logo variant="mark" size={40} />              // sidebar colapsado
<Logo variant="icon" size={20} />              // tamaños chicos, badges, nodos
<Logo variant="vertical" size={120} />         // login, splash
<Logo variant="mark" size={40} accent="#FFB4A2" /> // hover / deshabilitado
```

El icono hereda `currentColor`, así que el color lo controla el contenedor. Solo el hilo coral está fijo. Para una tinta plana (impresión, sello, marca de agua) pasa `accent="currentColor"`, como en el panel de marca de `LoginPage.tsx`.

## Reglas de uso

- **Área de respeto**: el alto de la burbuja del icono por cada lado.
- **Tamaño mínimo**: lockup horizontal a 24 px de alto; por debajo, `variant="icon"`.
- **Fondo claro**: el lockup va en `#171717`, nunca en negro puro.
- **No** cambies la proporción entre icono y logotipo, ni recolorees el hilo salvo a `#FFB4A2` o a una tinta plana.
- El hilo coral siempre sale por la derecha. Para RTL, espeja el bloque completo, no solo el icono.

## Tipografía

Logotipo: **Sora 600**, tracking -2.5%, ya vectorizado en `Logo.tsx`.
