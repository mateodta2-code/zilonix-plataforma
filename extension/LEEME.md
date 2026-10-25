# Extensión de Chrome — Investigación Zilonix Seller

Lee, en la página que ya tenés abierta (Mercado Libre Colombia, Amazon, Temu, AliExpress, Shein o Alibaba), los mismos datos que ves en pantalla: título, precio, precio anterior, descuento, vendidos (cuando el sitio los muestra), vendedor o tienda, calificación y número de opiniones — y en Mercado Libre, además, si es catálogo, Full y envío gratis.

**Mercado Libre, "vendidos" exacto**: la interfaz solo muestra una etiqueta redondeada ("+500 vendidos"), pero el número real sigue viajando en el JSON que la propia página incrusta para pintarse — se lee ese JSON (o, si cambió de forma, se lo busca directo en el HTML como texto) y se muestra "Vendidos (exacto)" cuando se encuentra, o "Vendidos (aproximado)" cuando solo queda la etiqueta redondeada. Esa lectura está amarrada al producto que estás viendo (el id sale de la URL): una página de producto también trae en el mismo JSON datos de OTROS productos (recomendados, "quienes vieron esto también vieron") — si no se puede confirmar que un `sold_quantity` es del producto actual, se usa el aproximado, nunca el de otro producto. Con el exacto (o el aproximado) y la fecha de publicación (también incrustada) se calcula "Ventas promedio al mes (estimado)" — siempre estimado, nunca una cifra que Mercado Libre confirme directamente. Nada de esto pide nada por red: todo sale del HTML que el navegador ya cargó.

- En una página de **producto**: un panel flotante con esos datos y un botón "Copiar datos (CSV)".
- En una página de **búsqueda o listado**: un resumen (cuántos productos se ven, precio mínimo/promedio/máximo, suma de vendidos visibles) y el top 10 por vendidos, con el mismo botón para copiar.
- En Mercado Libre, además, **"Seguir en Zilonix"**: en una página de producto o de tienda/vendedor, un botón que abre (solo con ese clic, nunca solo) una pestaña nueva hacia Zilonix Seller para agregar ese producto o vendedor al seguimiento. La URL de Zilonix Seller sale de `extension/config.js` (producción por defecto, staging comentado ahí mismo).

**Qué NO hace, a propósito**: no navega por su cuenta, no inicia sesión, no evade bloqueos ni captchas, y no hay ningún scraper corriendo en un servidor — todo lo que lee sale del HTML que el navegador YA cargó, en la pestaña que la persona ya tiene abierta. Un dato que el sitio no muestra sale como "No disponible", nunca inventado. La única excepción a "nunca manda nada a Zilonix Seller" es el puente de "Completar vendidos" (ver abajo) — y ahí tampoco abre ninguna pestaña por su cuenta: siempre es la propia página de Zilonix Seller la que abre las pestañas de Mercado Libre, y siempre por UN clic real de la persona, nunca sola.

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

Los selectores de cada sitio (`extension/lectores/*.js`) y el panel (`extension/content.js`) corren dentro del navegador — no se pueden probar con vitest sin un navegador real. Las funciones que SÍ son texto puro, sin DOM, están separadas justo para poder probarse con un HTML/texto de ejemplo: `extension/seguridad.js` (escapar HTML, validar que un link sea http(s) real, neutralizar una fórmula de Excel/Sheets en el CSV) y, en Mercado Libre, `leerDatosIncrustados`/`calcularVentasPromedioMes` (`extension/lectores/mercadolibre.js`). `extension/seguridad.test.ts` y `extension/lectores/mercadolibre.test.ts` corren con el resto de `npm test`, igual que cualquier prueba de `lib/`.

## Si un sitio cambió y algún dato dejó de aparecer

Cada sitio tiene su propio archivo en `extension/lectores/<sitio>.js`, con una lista corta de selectores por campo (el primero que encuentra en la página, de arriba hacia abajo). Si un campo empieza a salir "No disponible" en un sitio donde antes sí aparecía, lo más probable es que ese sitio haya cambiado su HTML — hay que abrir la página real, inspeccionar el elemento (clic derecho → Inspeccionar) y agregar el selector nuevo a la lista de ese campo, sin tocar nada de `content.js` ni de los otros lectores.

Si "Vendidos (exacto)" de Mercado Libre empieza a salir siempre como "(aproximado)": lo más probable es que Mercado Libre haya renombrado `window.__NORDIC_RENDERING_CTX__` — buscar en el código fuente de una página de producto real (clic derecho → "Ver código fuente") qué variable global trae ahora `sold_quantity`, y actualizar `NOMBRE_VARIABLE_INCRUSTADA` en `extension/lectores/mercadolibre.js`. El respaldo de buscar `"sold_quantity"` directo en el texto del HTML sigue funcionando aunque cambie el nombre de la variable — solo se pierde si Mercado Libre deja de incrustar ese dato por completo.
