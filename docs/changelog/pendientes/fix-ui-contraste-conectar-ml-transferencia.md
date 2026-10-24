- **2026-10-24** — issue #181 (follow-up UI, Refs), bug real en staging (tema claro): `.mensaje`/`.aclaracion` de `/panel/conectar-ml/confirmar-transferencia` y `.avisoExito` ("Cuenta conectada.") de `/panel/conectar-ml` caían directo sobre la franja oscura del degradado de fondo (`--fondo-app-*`, `app/globals.css` — en claro sigue siendo azul metálico → negro ahí arriba, igual que en oscuro) con `--texto`/`--texto-suave` normales, pensados para fondo blanco y negros en claro — ilegibles.

  **Arreglo**: mismo patrón que `EncabezadoPagina.module.css` — `color: var(--texto-zona-oscura)` / `var(--texto-suave-zona-oscura)` (valor fijo, igual en los dos temas, confirmado que existen en `app/globals.css`) en `app/panel/conectar-ml/confirmar-transferencia/page.module.css` (`.mensaje`, `.aclaracion`) y `app/panel/conectar-ml/page.module.css` (`.avisoExito`).

  **Verificado y NO tocado a propósito**: `.avisoError`/`.avisoErrorTexto` cae en la MISMA posición (justo debajo del encabezado), pero su fondo (`color-mix(in srgb, var(--peligro) 10%, var(--superficie))`, con `--superficie` opaco) da un resultado 100% opaco — tapa el degradado entero, igual que una tarjeta — así que `--texto` normal ahí sigue siendo el correcto, mismo criterio que `.filaCuenta`/tarjetas blancas (que tampoco se tocan).

  **No se tocó**: ninguna migración, `docs/CHANGELOG.md`, la versión de `package.json`, ningún test (cambio puro de CSS, sin lógica).

  Verificado: `npm run typecheck` en verde. `npm test`: 507 pruebas en verde (sin DB), mismos 20 archivos fallando solo por `DATABASE_URL_APP`/`DATABASE_URL_TRABAJADOR` ausentes en este entorno — ninguno nuevo por este cambio.
