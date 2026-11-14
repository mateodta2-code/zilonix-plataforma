- **2026-11-14 (Refs #42)** — Release selectivo a `produccion`: portada nueva de venta y dominio `seller.zilonix.com`. Versión `0.3.0` → `0.3.1` (`package.json` y `package-lock.json`). Cherry-picks desde `main` sobre el tip de `produccion` (`34381c6` / PR #399). **Sin migraciones**. No entran Finanzas/Pedidos de Sharel, WMS de Franky, ni Foro/Despachos/Publicidad de Santiago. No cambian las versiones de `next`, `react`, `@clerk/*` ni `drizzle`.

  **Incluido (squash commits de main, en orden):**
  - #358 login y registro van a `/panel` (`f7267b4`)
  - #359 portada pública de venta (`4459239`)
  - #402 extensión 0.3.44, resumen corto del manifest (`5dc11a2`)
  - #405 rutas `/iniciar-sesion` y `/empezar`, WhatsApp 573195647519, `APP_URL` validada y hosts de `seller.zilonix.com` en la extensión (`82db269`)

  **Conflictos:**
  - `app/page.tsx` en #358: producción no tenía el aviso de `?salida=cuenta-borrada` (ese flujo no está en esta rama). Se tomó la página de #358, que redirige a `/panel` con sesión y conserva el aviso que su propia prueba cubre.
  - `/privacidad` en #359: se conservó el texto legal real de #391. No queda "En preparación".
  - `scripts/verificar-permisos.test.ts`: no se clasificaron rutas de mis-datos (no existen acá). `/privacidad` mantiene el motivo de producción. Se agregaron `/terminos` y `/cookies`.
  - `lib/rutas-publicas.ts`: `/privacidad` queda una sola vez.
  - `.env.example` en #405: se agregaron `APP_URL`, `PUBLIC_APP_URL` y `NEXT_PUBLIC_APP_URL` vacías. No se trajeron `CANVA_CLIENT_ID` ni `CANVA_CLIENT_SECRET` (ese módulo no está en este release).
  - Íconos: la portada nombra `inventario` y `promociones`, que no están en producción. No se trajeron esos PRs. Solo se copió el dibujo de los dos íconos para que la página compile.

  **Texto legal que no está:** `/terminos` y `/cookies` no tienen texto real ni en producción ni en estos cuatro PRs. Siguen como los dejó #359. No se inventó un texto legal.

  **No hace falta** correr migraciones ni tocar Railway, DNS o Clerk desde este PR. `APP_URL` en Railway queda fuera de este cambio.

Refs #42
