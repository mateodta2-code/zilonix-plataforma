# Extensión de Chrome — Investigación Zilonix Seller

Lee, en la página que ya tenés abierta (Mercado Libre Colombia, Amazon, Temu, AliExpress, Shein o Alibaba), los mismos datos que ves en pantalla: título, precio, precio anterior, descuento, vendidos (cuando el sitio los muestra), vendedor o tienda, calificación y número de opiniones — y en Mercado Libre, además, si es catálogo, Full y envío gratis.

**Mercado Libre, "vendidos" exacto**: la interfaz solo muestra una etiqueta redondeada ("+500 vendidos"), pero el número real sigue viajando en el JSON que la propia página incrusta para pintarse — se lee ese JSON (o, si cambió de forma, se lo busca directo en el HTML como texto) y se muestra "Vendidos (exacto)" cuando se encuentra, o "Vendidos (aproximado)" cuando solo queda la etiqueta redondeada. Esa lectura está amarrada al producto que estás viendo (el id sale de la URL): una página de producto también trae en el mismo JSON datos de OTROS productos (recomendados, "quienes vieron esto también vieron") — si no se puede confirmar que un `sold_quantity` es del producto actual, se usa el aproximado, nunca el de otro producto. Con el exacto (o el aproximado) y la fecha de publicación (también incrustada) se calcula "Ventas promedio al mes (estimado)" — siempre estimado, nunca una cifra que Mercado Libre confirme directamente. Nada de esto pide nada por red: todo sale del HTML que el navegador ya cargó.

- En una página de **producto**: un panel flotante con esos datos y un botón "Copiar datos (CSV)".
- En una página de **búsqueda o listado**: un resumen (cuántos productos se ven, precio mínimo/promedio/máximo, suma de vendidos visibles) y el top 10 por vendidos, con el mismo botón para copiar — y, issue #213, un botón **"Enviar a Zilonix"** para importar ese listado al panel de Investigación (ver abajo).
- En Mercado Libre, además, **"Seguir en Zilonix"**: en una página de producto o de tienda/vendedor, un botón que abre (solo con ese clic, nunca solo) una pestaña nueva hacia Zilonix Seller para agregar ese producto o vendedor al seguimiento. La URL de Zilonix Seller sale de `extension/config.js` (producción por defecto, staging comentado ahí mismo).

**Qué NO hace, a propósito**: no inicia sesión, no evade bloqueos ni captchas, y no hay ningún scraper corriendo en un servidor (nunca Apify ni similar) — todo lo que lee sale del HTML que el navegador YA carga, en una pestaña real de Chrome (de la persona, o del escaneo/lectura de abajo). Un dato que el sitio no muestra sale como "No disponible", nunca inventado — y nunca se estima una visita ni se calcula "ventas/mes" sin una fecha de publicación real (`date_created`); si falta, el resultado es `null`, nunca un número inventado. Las únicas excepciones a "nunca manda nada a Zilonix Seller" son los cuatro puentes de abajo ("Completar vendidos", "Importar listado", "Analizar estilo OS" y "Top 8 reseñas") — y en los cuatro, todo cuelga de UN solo clic real de la persona, nunca de nada automático sin ese clic. Las únicas excepciones reales a "nunca navega por su cuenta" son "Analizar estilo OS" (issue #221, hasta 5 queries, pestañas ACTIVAS que se cierran cada una antes de abrir la siguiente) y "Top 8 reseñas" (issue #225, una sola pestaña de FONDO reutilizada para hasta 8 publicaciones) — las dos acotadas, arrancadas solo por ese único clic, y ninguna de las dos abre jamás una publicación individual fuera de lo que la propia persona ya autorizó. En "Completar vendidos" sigue siendo la propia página de Zilonix Seller la que abre las pestañas, no la extensión.

## "Completar vendidos" — puente extensión → panel (issue #210)

La API oficial de Mercado Libre no deja ver `sold_quantity` (vendidos real) para todos los candidatos que trae una búsqueda en `/panel/investigacion` — cuando falta, el panel ofrece un botón **"Completar vendidos (~5)"** que, con un solo clic real de la persona, abre en pestañas nuevas hasta 5 candidatos sin ese dato (siempre links que ya vienen en el resultado de la búsqueda — nunca inventados, nunca un término de búsqueda nuevo). Esa apertura la hace la propia página de Zilonix Seller (`window.open`, dentro del mismo manejador del clic) — la extensión no participa en abrir nada.

Cuando una de esas pestañas de Mercado Libre carga, el lector de siempre (`extension/lectores/mercadolibre.js`) ya confirma `itemId`, `vendidos` (exacto o aproximado) y `dateCreated` — issue #210 agrega que, si hay un `itemId` real, `content.js` manda esos datos un paso más allá:

1. **Pestaña de Mercado Libre → `background.js`**: `chrome.runtime.sendMessage({ tipo: "zilonix:vendidos", payload })`, con `payload = { itemId, sold_quantity, date_created, esFull, etiquetaMasN }` (`etiquetaMasN` = `true` cuando el número es solo la etiqueta redondeada "+N vendidos", no el `sold_quantity` exacto — mismo significado que en `lib/ml/estimacionVentas.ts`).
2. **`background.js` → todas las pestañas abiertas**: reenvía el mismo mensaje a cada pestaña (`chrome.tabs.sendMessage`) — sin pedir el permiso `"tabs"` ni `"host_permissions"`, nunca hace falta: solo la pestaña con `marcador-zilonix.js` cargado (la del panel de Investigación) tiene algo escuchando; en el resto, el envío simplemente falla en silencio.
3. **`marcador-zilonix.js` → la página**: `window.postMessage({ fuente: "zilonix-extension", tipo: "vendidos-completados", payload }, window.location.origin)` — con el `origin` real de la página, nunca `"*"`, para que ningún otro sitio pueda escucharlo.
4. **La página (`app/panel/investigacion/PanelDemanda.tsx`)**: escucha `window.addEventListener("message", ...)`, valida `event.origin`/`event.source` y la forma del payload, y solo complementa una fila que **todavía no tenía** vendidos real — nunca pisa un dato que la API ya había confirmado.

Reglas que este puente nunca rompe (las mismas de siempre, explícitas acá porque es la primera vez que la extensión manda algo de vuelta a Zilonix Seller):

- **Nunca** inicia sesión ni guarda ninguna credencial — todo esto corre con la sesión que la persona ya tiene abierta en su propio navegador.
- **Nunca** evade un captcha ni un bloqueo de Mercado Libre.
- **Nunca** hay un scraper del lado del servidor — todo el dato sale del HTML que la pestaña de Mercado Libre ya cargó para la propia persona.
- **Nunca** inventa una visita ni una vendidos que Mercado Libre no mostró — si el lector no confirma nada, no se manda ningún mensaje.
- **Nunca** abre una pestaña sin un clic real de la persona — ni la extensión ni el panel abren nada por su cuenta, nunca en un `useEffect`, nunca al recibir un mensaje.

## "Importar listado" — puente extensión → panel (issue #213)

La extensión ya lee listados/búsquedas en los 6 sitios (Mercado Libre, Amazon, Temu, AliExpress, Shein, Alibaba) pero, antes de esta tarea, ese resumen se quedaba solo en el panel flotante — nunca llegaba a Zilonix Seller. Ahora, en una página de búsqueda/listado, el botón **"Enviar a Zilonix"** (al lado de "Copiar datos (CSV)") manda, con un solo clic real de la persona, hasta 20 candidatos (título, precio, vendidos si el sitio lo muestra, link ya resuelto a absoluto) por el mismo relevo que "Completar vendidos":

1. **Pestaña del sitio → `background.js`**: `chrome.runtime.sendMessage({ tipo: "zilonix:listado", payload })`, con `payload = { plataforma, url, productos: [{ titulo, precio, vendidos, link }] }` — `plataforma` es el nombre del sitio (`lector.sitio`); `link` ya pasó por `ZilonixSeguridad.linkSeguro` (resuelto primero contra la URL de la página, por si venía relativo) y viene `null` si no se pudo confirmar uno real.
2. **`background.js` → todas las pestañas abiertas**: mismo relevo genérico que "Completar vendidos" (`TIPOS_RELEVADOS` ahora incluye `"zilonix:listado"`) — sin ningún permiso nuevo.
3. **`marcador-zilonix.js` → la página**: `window.postMessage({ fuente: "zilonix-extension", tipo: "listado-importado", payload }, window.location.origin)`.
4. **La página (`app/panel/investigacion/PanelDemanda.tsx`)**: valida el mensaje y lo guarda como **pendiente** — nunca se importa solo con recibirlo. La persona elige: **"Importar listado"** (primera vez, sin nada importado todavía), **"Fusionar con lo importado"** (agrega sin duplicar por link) o **"Reemplazar lo importado"** (descarta la sesión anterior), o **"Descartar"**. Los productos importados se muestran en su propia tabla, con badge de plataforma — **nunca se mezclan** con la tabla de arriba (los datos reales de la API de Mercado Libre): son candidatos de otra plataforma, o de un listado leído a mano, y nunca pisan ni compiten con `sold_quantity` real. Tampoco se les calcula "ventas/mes estimadas" ni facturación — ese cálculo (`lib/ml/estimacionVentas.ts`) solo está confirmado contra datos reales de Mercado Libre.

Mismas reglas que "Completar vendidos" (ver arriba) aplican acá sin excepción — en particular: nunca inicia sesión, nunca evade un bloqueo/captcha, nunca hay un scraper de servidor (nunca Apify ni similar — todo sale del HTML que la pestaña ya cargó), nunca inventa una visita o un vendidos que el sitio no mostró, y nunca manda nada sin el clic real de "Enviar a Zilonix".

## "Analizar estilo OS" — escaneo automático de listados reales (issue #221, slice 1: solo Mercado Libre)

Decisión de Sharel: construir Investigación con la misma ambición agresiva de Zilonix OS/Selltrix — **sin copiar sus bugs reales** (facturación histórica × precio tratada como si fuera mensual; visitas inventadas como `ventas ÷ 3%`). Esta tarea es la primera vuelta: un solo clic en **"Analizar"** (`/panel/investigacion`), con la extensión instalada, también escanea el listado REAL de Mercado Libre (no solo la API de catálogo) para el término y unas pocas variantes — amplía la cobertura a publicaciones que la API no enlaza.

**El clic de "Analizar" es el ÚNICO clic que autoriza todo esto** — `app/panel/investigacion/FormularioAnalizar.tsx` deja una marca de un solo uso con ventana de 8s (`analizarClic.ts`) justo antes de que el formulario navegue de verdad (GET normal, sin `preventDefault`); `PanelDemanda.tsx`, al montar en la página nueva, consume esa marca — si expiró (ej. la persona solo cambió de pestaña Mercado→Demanda tiempo después) o no hay extensión, nunca se dispara nada.

1. **Queries (issue #225, "5 búsquedas")**: `app/panel/investigacion/actions.ts` (Server Action) le pide a `lib/ml/variantesIA.ts` (nuevo, server-only, usa `lib/anthropic.ts`/`ANTHROPIC_API_KEY`) 4 variantes cortas por IA — mismo prompt, mismo espíritu que `zilonix-os-web` (`lib/busqueda-productos.js`, `generarVariantes`). `completarQueriesAnalizar` (`lib/ml/variantesBusqueda.ts`, puro, probado) dedupea (minúsculas + sin tildes + espacios colapsados) y, si la IA falla/viene vacía/repite el término, completa con la heurística mecánica de siempre (sin tildes, orden invertido, singular/plural ingenuo) hasta 5 queries únicas: término + hasta 4 variantes. La IA nunca puede romper Analizar — cualquier falla cae al respaldo de reglas.
2. **Página → `background.js`**: `window.postMessage({ fuente: "zilonix-panel", tipo: "iniciar-escaneo", payload: { terminos } })` (ahora hasta 5, no 4), reenviado por `marcador-zilonix.js` (dirección INVERSA a los dos puentes de arriba — primera vez que la página le pide algo a la extensión, no al revés) como `chrome.runtime.sendMessage({ tipo: "zilonix:iniciar-escaneo", payload })`.
3. **El escaneo en sí (`background.js`)**: por cada query (tope `TOPE_TERMINOS_ESCANEO = 5`), `chrome.tabs.create({ url: "https://listado.mercadolibre.com.co/<término-con-guiones>?_zilonix_escaneo=1", active: true })` — una pestaña ACTIVA a la vez, nunca en paralelo. `content.js` reconoce el marcador `_zilonix_escaneo=1` (propio, invisible para Mercado Libre) y manda sola (sin esperar ningún clic) hasta 20 candidatos (`TOPE_PRODUCTOS_ENVIO_LISTADO`, el mismo tope de "Importar listado") como `{ tipo: "zilonix:escaneo-resultado", payload: { productos } }`. `background.js` cierra esa pestaña (`chrome.tabs.remove`) y abre la siguiente query — nunca dos al mismo tiempo, nunca más de las 5. Si una nunca contesta (bloqueo, captcha, red lenta), un timeout de 15s la cierra igual y sigue — nunca se cuelga para siempre.
4. **Fin del escaneo → el panel**: `background.js` junta los resultados de todas las variantes y manda UN solo `{ tipo: "zilonix:listado", payload: { productos, origen: "escaneo-analizar" } }` a la pestaña del panel (y la vuelve a poner activa). `PanelDemanda.tsx` reconoce `origen: "escaneo-analizar"` y lo fusiona directo con lo ya importado (reusa `fusionarProductosImportados`, issue #213) — sin pedir "Importar/Fusionar/Reemplazar" otra vez: la persona ya autorizó todo esto con el clic de Analizar. Un "Enviar a Zilonix" manual en una pestaña que la persona abrió por su cuenta sigue pidiendo esa confirmación, sin cambios.
5. **Default, a propósito (issue #221, punto 7)**: el escaneo **nunca** abre la publicación individual de ningún candidato encontrado — ni al terminar, ni en ningún momento. Eso queda para que la persona lo pida a mano con "Completar vendidos" (issue #210), aparte.

**Por qué estos candidatos nunca tienen "ventas/mes estimadas" ni facturación**: un listado/búsqueda de Mercado Libre nunca expone `date_created` por tarjeta (solo la página de UN producto lo trae, issue #174) — sin esa fecha, `lib/ml/estimacionVentas.ts` (`ventasMesEst`) no puede calcular nada, y devuelve `null` en vez de inventar. Esto evita, por construcción, el bug real de Zilonix OS de tratar el vendidos acumulado histórico × precio como si fuera una cifra mensual — acá simplemente nunca se intenta esa cuenta para estos candidatos. Tampoco se inventa ninguna visita (`ventas ÷ 3%` o cualquier otra fórmula): esta app nunca estima visitas, en ningún módulo.

**Limitación conocida y documentada**: un Service Worker de Manifest V3 puede reciclarse si queda sin eventos por ~30s. Un escaneo de hasta 5 queries con 15s de margen cada una normalmente lo mantiene vivo, pero si Chrome lo recicla a mitad de camino, ese escaneo puntual se pierde sin aviso — el panel tiene su propio timeout (90s) para nunca quedarse mostrando "Escaneando…" para siempre, pero la persona tendría que volver a apretar Analizar. No hay todavía un estado persistido (`chrome.storage.session`) para sobrevivir un reciclado — fuera de alcance de este slice. Mismo riesgo aplica a la lectura de reseñas, abajo.

**Fuera de alcance de #221/#225, a propósito**: Amazon/Temu/AliExpress/Shein/Alibaba (el escaneo automático es solo Mercado Libre — esas 5 plataformas siguen siendo "Enviar a Zilonix" manual, issue #213), "mejor oferta" entre plataformas, e historial de escaneos (quedan para "Code 2", una vuelta aparte).

## "Top 8 reseñas" (issue #225)

Tras un análisis, el panel ya tiene el Top 8 por vendidos real (es el mismo orden que ya muestra la tabla de Demanda — ninguna llamada nueva) con link real — un botón **"Ver reseñas"** (clic real, nunca automático) le pide a la extensión leer las reseñas de esas 8 publicaciones.

La API de Mercado Libre de reseñas (`/reviews/item/{id}`) da 403 para publicaciones ajenas (confirmado en vivo) — se leen del HTML que la propia PDP ya trae, mismo mecanismo confirmado en vivo por Cowork en `zilonix-os-web` (`chrome-extension-busqueda/scraper-pdp-resenas.js`): un `<script id="__NORDIC_RENDERING_CTX__">` con `_n.ctx.r={...}` adentro — **distinto** del marcador que ya usa "Completar vendidos" (`window.__NORDIC_RENDERING_CTX__` como asignación de variable) — nunca se asumió que eran el mismo blob sin confirmarlo así, puntual.

1. **Panel → `background.js`**: `window.postMessage({ fuente: "zilonix-panel", tipo: "iniciar-resenas", payload: { items: [{ itemId, link }] } })` (hasta 8), reenviado por `marcador-zilonix.js` como `chrome.runtime.sendMessage({ tipo: "zilonix:iniciar-resenas", payload })`.
2. **Una sola pestaña reutilizada** (`background.js`, mismo patrón que `leerResenasTop`/`leerResenaDeUnaPdp` de `zilonix-os-web`): `chrome.tabs.create({ url: "about:blank", active: false })` UNA vez, y después `chrome.tabs.update(tabId, { url })` por cada publicación — son hasta 8 navegaciones, nunca 8 pestañas. Pausa de 500ms entre cada una; timeout de 14s por publicación (con margen real sobre lo que `content.js` puede tardar en reintentar la lectura).
3. **`content.js`/`extension/lectores/mercadolibre.js` (`leerResenas`/`leerResenasDesdeScript`)**: en CUALQUIER página de producto (no solo durante una lectura activa — igual que ya hace `enviarVendidosAZilonix`), si se confirma `reviews_capability_v3`, manda `{ tipo: "zilonix:resena", payload: { itemId, resena } }`. `background.js` solo le hace caso si esa pestaña es justo la que está conduciendo una lectura de reseñas en este momento (por `tabId`, nunca por adivinar); cualquier otra se ignora sin romper nada. Rutas leídas: `R.rating.amount` (total), `R.rating.average` (promedio), `R.rating.levels[]` (índice 0 = 5★ … índice 4 = 1★; positivas = 5★+4★, negativas = 2★+1★), `R.reviews[]` (SOLO las visibles — nunca todas).
4. **Fin → el panel**: `background.js` cierra la pestaña reutilizada y manda `{ tipo: "zilonix:resenas-resultado", payload: { resenasPorItemId } }` a la pestaña del panel, reenviado por `marcador-zilonix.js` como `postMessage({ ..., tipo: "resenas-leidas" })`.

**Se avisa explícitamente en el panel** que positivas/negativas/recientes solo cuentan las reseñas VISIBLES en la página (`R.reviews`, no `R.rating.amount`) — si el total real es mayor, eso es un piso, nunca el dato completo. Las fechas de las reseñas son relativas ("Hace 3 meses") — nunca una fecha exacta, mismo criterio que Mercado Libre ya usa.

## Instalar en Chrome (modo desarrollador)

1. Abrí Chrome y entrá a `chrome://extensions`.
2. Arriba a la derecha, activá **"Modo de desarrollador"** (el interruptor).
3. Hacé clic en **"Cargar descomprimida"** ("Load unpacked").
4. Elegí la carpeta `extension/` de este repositorio (la que tiene `manifest.json` adentro) — no el ZIP, la carpeta descomprimida.
5. Listo: el ícono de la extensión aparece en la barra de Chrome. Entrá a un producto o una búsqueda en cualquiera de los 6 sitios y el panel aparece solo, abajo a la derecha.

## Cada vez que haya un cambio

Regla de este proyecto (CLAUDE.md): **toda actualización de la extensión necesita reinstalación completa** — nunca alcanza con el botón "Recargar" (↻) de `chrome://extensions`.

1. Confirmá que `extension/version.json` ya tiene la versión nueva.
2. En `chrome://extensions`, quitá la extensión vieja (**"Quitar"**).
3. Volvé a cargarla descomprimida desde cero (pasos 3-4 de arriba).

## Armar el ZIP para repartir

```bash
npm run extension:zip
```

Deja el archivo en `dist/extension/zilonix-investigacion-v<version>.zip` (usa la versión de `extension/version.json`). Quien lo reciba también instala "descomprimido": descomprime el ZIP primero y carga esa carpeta con "Cargar descomprimida" — Chrome no instala un ZIP directamente.

## Pruebas

Los selectores de cada sitio (`extension/lectores/*.js`), el panel (`extension/content.js`) y la orquestación con `chrome.tabs.*` (`extension/background.js`) corren dentro del navegador — no se pueden probar con vitest sin un navegador real. Las funciones que SÍ son texto puro, sin DOM, están separadas justo para poder probarse con un HTML/texto de ejemplo: `extension/seguridad.js` (escapar HTML, validar que un link sea http(s) real, neutralizar una fórmula de Excel/Sheets en el CSV) y, en Mercado Libre, `leerDatosIncrustados`/`calcularVentasPromedioMes`/`leerResenasDesdeScript` (`extension/lectores/mercadolibre.js`, issue #225 para la última). `extension/seguridad.test.ts` y `extension/lectores/mercadolibre.test.ts` corren con el resto de `npm test`, igual que cualquier prueba de `lib/` — incluida `lib/ml/variantesBusqueda.test.ts` (heurística de variantes + `completarQueriesAnalizar`, issue #221/#225).

## Si un sitio cambió y algún dato dejó de aparecer

Cada sitio tiene su propio archivo en `extension/lectores/<sitio>.js`, con una lista corta de selectores por campo (el primero que encuentra en la página, de arriba hacia abajo). Si un campo empieza a salir "No disponible" en un sitio donde antes sí aparecía, lo más probable es que ese sitio haya cambiado su HTML — hay que abrir la página real, inspeccionar el elemento (clic derecho → Inspeccionar) y agregar el selector nuevo a la lista de ese campo, sin tocar nada de `content.js` ni de los otros lectores.

Si "Vendidos (exacto)" de Mercado Libre empieza a salir siempre como "(aproximado)": lo más probable es que Mercado Libre haya renombrado `window.__NORDIC_RENDERING_CTX__` — buscar en el código fuente de una página de producto real (clic derecho → "Ver código fuente") qué variable global trae ahora `sold_quantity`, y actualizar `NOMBRE_VARIABLE_INCRUSTADA` en `extension/lectores/mercadolibre.js`. El respaldo de buscar `"sold_quantity"` directo en el texto del HTML sigue funcionando aunque cambie el nombre de la variable — solo se pierde si Mercado Libre deja de incrustar ese dato por completo.
