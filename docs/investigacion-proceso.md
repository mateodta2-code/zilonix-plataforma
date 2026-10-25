# Investigación — proceso end-to-end (issues #197/#210/#213/#221/#222/#225/#227)

Resumen de cómo funciona hoy el módulo de Investigación (`/panel/investigacion`), de punta a punta, después de que el issue #227 le sacó la dependencia de la API de catálogo de Mercado Libre. Para el detalle técnico de la extensión (mensajes, selectores por sitio, timeouts) ver [`extension/LEEME.md`](../extension/LEEME.md) — esta página es el mapa de arriba: por qué existe cada pieza y cómo se conectan.

**`/panel/investigacion/seguimiento` (seguimiento diario) es un módulo aparte y no se tocó en ninguna de estas tareas** — sigue 100% sobre la API oficial de Mercado Libre (`lib/ml/cliente.ts`), con su propio snapshot diario (`lib/trabajos/revisionDiariaSeguimiento.ts`) y su propia seguridad por fila. Todo lo que sigue es solo del módulo de Investigación (Demanda/Mercado/Estrategia).

## Por qué existe este módulo así (el motivo real, no solo el diseño)

Decisión de Sharel: construir Investigación con la misma ambición que Zilonix OS/Selltrix — sin copiar sus bugs reales. El punto de partida (#221) fue competir en volumen de datos; el punto de llegada (#227) fue sacar la dependencia que lo frenaba.

**Smoke real con Sharel, término "calzado"**: Selltrix mostraba ~24 publicaciones con datos útiles, Zilonix OS ~40, y esta plataforma apenas ~6 — casi todas "Sin dato" — mientras Demanda/Mercado/Estrategia pintaban desde `buscarInvestigacionProducto` (la API de catálogo de Mercado Libre, en `lib/ml/investigacion.ts`, **borrado en #227**). No era un bug puntual: la API de catálogo nunca iba a dar ese volumen para este uso. Issue #227 saca esa dependencia por completo — las tres pestañas ahora se calculan del lado del cliente sobre listados reales (no catálogo) escaneados por la extensión, mismo espíritu que Zilonix OS/Selltrix.

## Las dos piezas que hacen esto posible

1. **La extensión de Chrome** (`extension/`) — lee el HTML que el navegador de la persona ya cargó en Mercado Libre o en cualquiera de las otras 5 plataformas soportadas. Nunca hay un scraper de servidor, nunca Apify, nunca inicia sesión, nunca evade un bloqueo o un captcha (si aparece uno, se avisa y se resuelve a mano). Todo cuelga de un clic real de la persona — nunca se abre una pestaña ni se navega por cuenta propia sin ese clic.
2. **`lib/ml/listadoCliente.ts`** — módulo puro, sin red ni base de datos, que recibe lo que la extensión mandó y calcula todo lo que el panel muestra: clasificación de señales de venta, orden, resumen, estrategia/veredicto, persistencia. Reemplaza, en un solo lugar, a los tres módulos que existían antes de #227 (`lib/ml/investigacion.ts`, `lib/ml/investigacionCliente.ts` de #210, `lib/ml/importacionListadoCliente.ts` de #213/#225 — los tres borrados).

`app/panel/investigacion/page.tsx` (Server Component) ya no habla con Mercado Libre: solo valida sesión/permiso y normaliza `termino`/`tab` de la URL. Todo el cálculo vive en `app/panel/investigacion/PanelInvestigacion.tsx` (Client Component).

## El flujo de "Analizar" (Mercado Libre, el caso principal)

1. La persona escribe un término, elige un **país de Mercado Libre** (ver abajo) y hace clic en **Analizar** (`app/panel/investigacion/FormularioAnalizar.tsx`). Ese clic deja una marca de un solo uso con ventana de 8 segundos (`analizarClic.ts`, `sessionStorage`) justo antes de que el formulario navegue — la única autorización real para lo que sigue.
2. La página nueva monta `PanelInvestigacion.tsx`, consume esa marca (si expiró o no hay extensión instalada, no pasa nada automático) y le pide a la Server Action `generarQueriesAnalizarAction` (`app/panel/investigacion/actions.ts`) hasta 4 variantes de búsqueda por IA (`lib/ml/variantesIA.ts`, `lib/anthropic.ts`) — con el término mismo son hasta 5 queries. Si la IA falla, viene vacía o repite el término, se completa con la heurística de reglas (`lib/ml/variantesBusqueda.ts`, sin tildes / orden invertido / singular-plural) — la IA nunca puede romper Analizar.
3. El panel le pide a la extensión escanear esas hasta 5 queries contra el listado real de Mercado Libre del país elegido (`extension/background.js`, una pestaña activa a la vez, timeout fijo de 15s por query).
4. Cada candidato que vuelve (título, precio, foto, vendedor, calificación, Full, envío gratis, y `vendidos` — crudo todavía) se clasifica con `clasificarSenalVentas` y se agrega como un **bloque** nuevo del stack (ver abajo).

## Las 6 plataformas

Mercado Libre es la única con escaneo automático desde el botón Analizar (arriba). Las otras 5 — **Amazon, Temu, AliExpress, Shein, Alibaba** — se analizan con su propio botón ("Analizar también en: …", en Demanda), un clic real por plataforma, nunca las 5 juntas. Mismo mecanismo de variantes por IA (prompts específicos por plataforma — inglés para Amazon/Alibaba, español de Colombia para Temu/AliExpress/Shein) y de escaneo (una sola pestaña reutilizada, nunca una pestaña nueva por término).

Cada plataforma tiene su propio lector confirmado contra el HTML/JSON real que esa página expone (`extension/lectores/{amazon,temu,aliexpress,shein,alibaba}.js`) — nunca selectores CSS genéricos ni inventados. Detalle completo de cada fuente en `extension/LEEME.md`.

**Alibaba, caso especial de calificación**: el sitio solo expone la calificación del *proveedor*, no del producto — por eso el lector siempre manda `calificacion: null` para Alibaba, a propósito, para nunca mostrar un dato que no corresponde al producto evaluado.

## `senalVentas` — por qué nunca se mezcla un acumulado con una tasa mensual

El bug real que esto existe para evitar (confirmado en Zilonix OS/Selltrix): tratar un número acumulado histórico como si fuera una venta mensual, o estimar visitas como `ventas ÷ 3%`. Esta plataforma nunca hace ninguna de las dos cosas, en ningún módulo.

`clasificarSenalVentas(plataforma, vendidos)` (`lib/ml/listadoCliente.ts`) etiqueta cada número de "vendidos" según lo que esa plataforma realmente confirma:

| Tipo | Significa | Quién lo tiene |
|---|---|---|
| `"mensual_piso"` | Tasa mensual real ("comprados el mes pasado") | **Solo Amazon** — único caso confirmado en vivo |
| `"acumulado_sin_periodo"` | Acumulado histórico, sin fecha de inicio | Mercado Libre, Temu, AliExpress, Shein, Alibaba |
| `"ausente"` | El sitio no mostró ningún número | Cualquiera |

`facturacionEstimadaListado(producto)` devuelve `null` para cualquier fila que no sea `"mensual_piso"` — es decir, para todo lo que no sea Amazon. Es la razón por la que la mayoría de las filas muestran "Sin dato" en la columna/sort de Facturación est.: es el comportamiento correcto, no un bug — inventar esa cifra sobre un acumulado sin período es exactamente lo que está prohibido.

`aplicarVendidosConfirmados` (heredado de #210, "Completar vendidos") sigue permitiendo que una fila con `senalVentas.tipo === "ausente"` y un `itemId` real de Mercado Libre se complete abriendo su publicación — nunca pisa un dato que ya estaba confirmado.

## Sorts, estilo Zilonix OS/Selltrix

`ordenarProductos(productos, criterio)` soporta los 6 criterios reales que usan OS/Selltrix: **Facturación est.** (solo filas `mensual_piso`, el resto al final) / **Más vendidos** / **Más calificación** / **Full** / **Más económico** / **Más caro**. Cualquier fila con un dato nulo para el criterio elegido siempre ordena al final — nunca se asume un valor que el sitio no confirmó.

## Stack y persistencia (1 hora)

Cada búsqueda/plataforma agrega su propio **bloque** debajo de los anteriores (`Bloque`, `lib/ml/listadoCliente.ts`) — nunca se mezclan dos plataformas o dos búsquedas distintas en una sola tabla. Los bloques se guardan en `localStorage` (`cargarBloques`/`guardarBloques`), cada uno con su propia marca de tiempo; al cargar la página, cualquier bloque con más de **`TTL_BLOQUE_MS` = 1 hora** de antigüedad se descarta solo. Esto es lo que hace que un resultado sobreviva un refresh de la página sin tener que volver a escanear.

## Selector de país de Mercado Libre

Mercado Libre opera distinto dominio por país — el selector en `FormularioAnalizar.tsx` deja elegir entre Colombia (default) y Argentina/Brasil/México/Chile/Uruguay/Perú (`DOMINIOS_ML_PAIS`, `extension/background.js`):

| País | Dominio | Confirmado en vivo |
|---|---|---|
| Colombia (CO) | `mercadolibre.com.co` | **Sí** — el único probado contra producción/staging hasta ahora |
| Argentina (AR) | `mercadolibre.com.ar` | No |
| Brasil (BR) | `mercadolivre.com.br` (Mercado Livre) | No |
| México (MX) | `mercadolibre.com.mx` | No |
| Chile (CL) | `mercadolibre.cl` | No |
| Uruguay (UY) | `mercadolibre.com.uy` | No |
| Perú (PE) | `mercadolibre.com.pe` | No |

Los 6 países no-CO usan el patrón público conocido de dominios de Mercado Libre — no es una suposición sobre un comportamiento interno de la API (eso sí está prohibido sin confirmarlo primero, ver `CLAUDE.md`), pero tampoco están probados todavía contra tráfico real. Si alguno falla (por ejemplo, un país que no use el subdominio `listado.`), se corrige `DOMINIOS_ML_PAIS` en `extension/background.js`.

## "Seguir solo ML"

El botón **"Seguir en Zilonix"** (que agrega un producto o vendedor al seguimiento diario, `/panel/investigacion/seguimiento`) existe **solo para Mercado Libre**. Ni las otras 5 plataformas ni los 6 países no-CO de Mercado Libre agregan nada a seguimiento — Investigación puede analizar cualquiera de las 6 plataformas y cualquiera de los 7 países, pero el seguimiento diario (con su snapshot, su API real y su RLS) sigue siendo un alcance deliberadamente más chico.

## Qué NO se copió de Zilonix OS/Selltrix (a propósito, prohibido en todo momento)

- **Nunca** tratar un acumulado histórico como si fuera una tasa mensual (ver `senalVentas`, arriba) — el bug real de OS que más se evitó en todas estas tareas.
- **Nunca** estimar visitas con `ventas ÷ 3%` ni ninguna fórmula similar — esta plataforma nunca estima visitas, en ningún módulo.
- **Nunca** un scraper de servidor — ni Apify ni equivalente. Todo lo que la extensión manda sale del HTML que el navegador de la persona ya cargó, en una pestaña real.
- **Nunca** iniciar sesión por la persona, ni evadir un captcha o un bloqueo — si aparece uno (hoy, solo confirmado en Alibaba), se detecta y se avisa para resolverlo a mano.
- **Nunca** una visita, una venta o una fecha inventada — un dato que el sitio no muestra sale como "Sin dato"/`null`, nunca un número construido para rellenar un hueco.
- **Nunca** mezclar datos de dos plataformas o dos búsquedas en la misma fila/bloque — cada combinación término+plataforma es su propio bloque en el stack.

## Qué quedó deliberadamente fuera (y por qué)

- **Veredicto sin "demanda alta/baja"**: la versión vieja (API de catálogo) clasificaba demanda alta/baja con `ventasMesTotalEstimadas`, que necesitaba `date_created` — un dato que un listado escaneado nunca expone (solo la página de un producto individual lo trae). `generarVeredictoListado` se simplificó a propósito para usar solo `vendedoresDistintos` (un dato que el listado sí puede confirmar de verdad) en vez de inventar un umbral nuevo sobre una métrica distinta.
- **Sin logos de plataforma**: se evaluó mostrar el logo real de cada sitio (Amazon/Temu/AliExpress/Shein/Alibaba/Mercado Libre) en el selector — se decidió no hacerlo: usar la marca de un tercero dentro de la interfaz propia de Zilonix es un riesgo real de marca. Se mantiene el badge de texto de siempre.
- **Sin botón de ayuda ("?")**: quedó fuera de #227 a propósito, para una vuelta aparte.
- **Estrellas/reseñas por tarjeta de listado en las 5 plataformas no-ML**: Alibaba no las tiene disponibles por producto (ver arriba); el resto, fuera de alcance todavía — issue aparte si hace falta.

## Dónde está cada pieza (índice rápido)

| Qué | Dónde |
|---|---|
| Cálculo de señales, orden, resumen, estrategia, persistencia | [`lib/ml/listadoCliente.ts`](../lib/ml/listadoCliente.ts) (+ `lib/ml/listadoCliente.test.ts`) |
| Variantes de búsqueda por IA + heurística de reglas | [`lib/ml/variantesIA.ts`](../lib/ml/variantesIA.ts), [`lib/ml/variantesBusqueda.ts`](../lib/ml/variantesBusqueda.ts) |
| Página y Server Actions | [`app/panel/investigacion/page.tsx`](../app/panel/investigacion/page.tsx), [`app/panel/investigacion/actions.ts`](../app/panel/investigacion/actions.ts) |
| Panel (Client Component), las 3 pestañas | [`app/panel/investigacion/PanelInvestigacion.tsx`](../app/panel/investigacion/PanelInvestigacion.tsx) |
| Marca de un solo clic que autoriza el escaneo | [`app/panel/investigacion/analizarClic.ts`](../app/panel/investigacion/analizarClic.ts) |
| Orquestación de pestañas, timeouts, país ML | [`extension/background.js`](../extension/background.js) |
| Lectores por plataforma | [`extension/lectores/`](../extension/lectores/) |
| Detalle completo de la extensión (mensajes, selectores, instalación) | [`extension/LEEME.md`](../extension/LEEME.md) |
| Seguimiento diario (módulo aparte, no tocado) | [`app/panel/investigacion/seguimiento/`](../app/panel/investigacion/seguimiento/), [`lib/seguimiento/`](../lib/seguimiento/) |
