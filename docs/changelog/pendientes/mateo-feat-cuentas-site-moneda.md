- **2026-10-30 (Refs #315)** — `cuentas_ml`: país (`site_id`), moneda e idioma reales, para que Seller funcione en otros países de LATAM, no solo Colombia.

  **1) Migración 0020 (Drizzle, generada con `npm run db:generate`, NO aplicada a ninguna base — eso se hace después, por el túnel privado)** — `db/migrations/0020_bizarre_arclight.sql`, solo `ADD COLUMN`/`ADD CONSTRAINT` en `cuentas_ml`, ninguna otra tabla, ningún `DROP`:
    ```sql
    ALTER TABLE "cuentas_ml" ADD COLUMN "site_id" text DEFAULT 'MCO' NOT NULL;--> statement-breakpoint
    ALTER TABLE "cuentas_ml" ADD COLUMN "moneda" text DEFAULT 'COP' NOT NULL;--> statement-breakpoint
    ALTER TABLE "cuentas_ml" ADD COLUMN "idioma" text DEFAULT 'es-CO' NOT NULL;--> statement-breakpoint
    ALTER TABLE "cuentas_ml" ADD CONSTRAINT "cuentas_ml_site_id_valido" CHECK ("cuentas_ml"."site_id" IN ('MCO', 'MLM', 'MLB', 'MLA', 'MLC'));
    ```
    `site_id` acotado con un `CHECK` (texto, no un enum real de Postgres — agregar un país más adelante es un `ALTER TABLE` simple, nunca el `ALTER TYPE` fuera de transacción que exige un enum). Las filas que ya existen quedan con el default (`MCO`/`COP`/`es-CO`) hasta que se reconecten.

  **2) Mapa de sitios** — `lib/ml/sitios.ts` (nuevo): `SITIOS_ML` (los 5 países que opera Zilonix: Colombia MCO/COP/es-CO, México MLM/MXN/es-MX, Brasil MLB/BRL/pt-BR, Argentina MLA/ARS/es-AR, Chile MLC/CLP/es-CL) y `datosSitioMl(siteId)`, que nunca lanza — un `site_id` desconocido o `null` cae al default. Con test propio (`lib/ml/sitios.test.ts`, 8 casos).

  **3) Al conectar/reconectar/transferir una cuenta, se llena de verdad** — `GET /users/me` ya se llamaba para traer el `nickname` (`lib/ml/oauth.ts`); esa misma respuesta YA trae `site_id` — se extrae ahí mismo, **sin ninguna llamada nueva a Mercado Libre** (`obtenerNickname` se renombró a `obtenerDatosVendedorMl`, devuelve `{nickname, siteId}`). `guardarCuentaConectada` y `transferirCuentaMlAOtraEmpresa` (`lib/ml/cuentas.ts`) reciben ese `siteId`, lo pasan por `datosSitioMl` y guardan `site_id`/`moneda`/`idioma` reales — en el INSERT, en el `ON CONFLICT DO UPDATE` (reconectar) y en la transferencia entre empresas. Si la cuenta cambió de país real entre una reconexión y otra, se actualiza — nunca se queda con un `site_id` viejo pisando uno nuevo real.
    - `lib/ml/cliente.ts` **no necesitó ningún cambio** — toda la lectura de `/users/me` ya vivía en `lib/ml/oauth.ts` (una excepción ya existente a "todo pasa por cliente.ts": el intercambio de código y la lectura del vendedor ocurren ANTES de que exista un token válido guardado, así que no pueden usar los helpers de cliente.ts, que asumen una cuenta ya conectada).

  **4) RLS intacta, sin tocar `db/rls-setup.sql`** — `cuentas_ml` ya tenía `ENABLE`/`FORCE ROW LEVEL SECURITY` y la política `aislamiento_cuentas_ml` (por `empresa_id`) desde antes; agregar 3 columnas nullable-con-default no cambia nada a nivel de fila — las políticas de RLS no dependen de qué columnas existan. Confirmado leyendo `db/rls-setup.sql`, no se tocó.

  **5) Coordinación con el issue #59** (Z-MT-03, "salud de cuentas ML") — su propio alcance también menciona agregar `site_id` a `cuentas_ml` en su migración. A la fecha de este PR, #59 todavía no tiene PR abierto ni se aplicó esa parte — **este PR es quien agrega `site_id` a `cuentas_ml`**; cuando se trabaje #59, su migración debe asumir que `site_id` ya existe (de esta) y agregar solo lo que falta (`estado`, `ultimo_refresh_ok_ts`, `ultimo_error`, `scopes`, el índice único parcial), nunca repetir `site_id`.

  **6) `docs/modelo-datos.md`** — nueva sección "9. `cuentas_ml` — país, moneda e idioma (Z-LATAM-01, issue #315)" con la tabla de columnas, el mapa y qué hace falta para agregar un país nuevo.

  **7) Lugares con `MCO`/`COP`/`es-CO` fijos — investigados, NINGUNO se cambió en este PR** (ver el por qué de cada grupo abajo; "Etapa 1" de este issue es la base de datos + el flujo de conectar, no una migración completa a multi-moneda):

    **a) Asunción real de país en flujos de Mercado Libre (requieren decidir qué `site_id` usar, no solo reemplazar el texto)**
    - `lib/ml/cliente.ts:21` — `export const SITE_ID = "MCO"`, usado en 4 funciones (`buscarProductosCatalogo`, `resolverCategoria`, `obtenerMejoresProductosCategoria`, `obtenerPublicacionesVendedorAjenoMl`) — el catálogo/categorías/destacados de Mercado Libre se buscan siempre contra el sitio de Colombia, sin importar la cuenta real. Cambiarlo exige pasar `siteId` por parámetro hasta cada ruta que llama estas funciones (`app/panel/publicar/**`, `app/api/ml/publicar/**`).
    - `app/panel/publicar/FormularioPublicar.tsx:23`, `app/panel/publicar/formulario-logica.ts` (2 lugares), `app/api/ml/publicar/categorias/buscar/route.ts:18` — mismo criterio, con el comentario explícito "único país en alcance".
    - `lib/ml/publicidad.ts:193` — elige el anunciante de Product Ads buscando `site_id === "MCO"` en la lista que devuelve Mercado Libre, en vez de usar el `site_id` real de la cuenta conectada.
    - `lib/publicidad/rotulos.ts:38` — `mco: "MCO"` es la clave/etiqueta de una columna de tabla (texto de UI) — revisar si esa columna debería mostrar el `site_id` real de cada fila en vez de un literal fijo.

    **b) Formato de moneda/números en pantalla (`.toLocaleString("es-CO")`, `$` fijo) — decisión de diseño pendiente: ¿se muestra en la moneda real de la cuenta, o se deja el formato actual para todas?**
    - Finanzas: `lib/finanzas/tablero.ts`, `components/finanzas/formato.ts`, `components/finanzas/textosTablero.ts`, `lib/metas-mensuales.ts`, `lib/panel-kpis.ts`.
    - Promociones: `app/panel/promociones/PaginaPromociones.tsx`, `app/panel/promociones/calculosFila.ts`, `lib/ml/promocionesEjecucion.ts` (mensaje de error con un monto).
    - Publicidad: `lib/publicidad/formato.ts`.
    - Despachos: `app/panel/despachos/TarjetaDespachoCliente.tsx`, `app/panel/despachos/page.tsx`, `lib/ml/despachos.ts`.
    - Inventario: `app/panel/inventario/compras/page.tsx`, `app/panel/inventario/configuracion/page.tsx`, `app/panel/inventario/kardex/page.tsx`.
    - Investigación: `app/panel/investigacion/PanelInvestigacion.tsx`, `app/panel/investigacion/seguimiento/page.tsx`, `app/panel/investigacion/seguimiento/[id]/page.tsx`.
    - Otros: `app/panel/pedidos/[id]/page.tsx`, `app/panel/soporte/page.tsx`, `app/panel/actividad/page.tsx`, `lib/ml/listadoCliente.ts`, `lib/ml/publicar.ts`, `lib/ml/publicar-tipos.ts`, `lib/ml/costos-item.ts`, `lib/seguimiento/alertas.ts`, `lib/seguimiento/link.ts`.

    Ninguno de estos es un cambio de una línea segura: todos requieren decidir PRIMERO si Zilonix va a mostrar cada cuenta en su propia moneda/locale real (lo que exige pasar `moneda`/`idioma` de `cuentas_ml` hasta cada componente de estas pantallas) o si el formato de pantalla se queda fijo en `es-CO` para todas las empresas sin importar el país de cada cuenta — esa es una decisión de producto, no una corrección de bug, y queda explícitamente fuera de "Etapa 1" de este issue.

  **No se tocó**: `db/rls-setup.sql` (no fue necesario), ninguna otra tabla además de `cuentas_ml`, `lib/ml/cliente.ts` (no fue necesario). La migración 0020 **no se aplicó a ninguna base** — eso queda pendiente, por el túnel privado, en una sesión aparte.

  Verificado: `npm run typecheck` en verde. `npx vitest run`: 1966 pruebas en verde (mismo baseline de siempre — los 47 archivos en rojo dependen de `DATABASE_URL_APP`/Postgres real, ausente en este sandbox, entre ellos `lib/ml/cuentas.test.ts`/`db/rls-cuentas-ml.test.ts`/`lib/ml/transferencia.test.ts`, que sí traen los tests nuevos de `site_id` — correrán reales en CI, que tiene su propio Postgres efímero). `npm run build`: compila y tipa en verde ("Linting and checking validity of types" limpio); el paso siguiente de Next ("Collecting page data") falla en este sandbox por la misma ausencia de `DATABASE_URL_APP` — no por este cambio.
