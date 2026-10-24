- **2026-10-24** — issue #193 (Refs), pedido de Sharel: en `/panel/investigacion/seguimiento`, junto al label "Link o id de Mercado Libre", un "?" accesible que explique en español simple qué formatos aceptan Producto y Tienda.

  **Nuevo `components/marco/Ayuda.tsx` + `.module.css`**: un `"?"` chico junto a una etiqueta, con un globo de texto que se muestra por `:hover` Y por `:focus-within` (teclado) — CSS puro, sin JS. El botón es `type="button"` (nunca dispara el submit del formulario que lo rodea) y usa `aria-describedby`/`role="tooltip"` para que un lector de pantalla también lo pueda leer sin depender del hover. El globo tiene su PROPIO fondo opaco (`--superficie-2`/`--texto-superficie-2`, mismo criterio que `.zx-control` desde el issue #186) — nunca hereda el `--texto` de zona oscura que una `<Tarjeta>` redefine para todo lo de adentro (este formulario vive dentro de una).

  **Contenido del globo**: Producto (link de publicación/catálogo o id MCOxxxxxxxx), Tienda (seller_id numérico, o un link con `seller_id=`/`CustId=`/`_CustId_`), aviso de que un link `/pagina/nombre` o `/tienda/nombre` SOLO (sin esos parámetros) no alcanza — hay que abrir un producto de esa tienda y copiar el seller_id, o usar el botón "Seguir" de la extensión —, y que "Es competidor" cuenta en el cupo de 5.

  **`lib/seguimiento/link.ts` — `interpretarEnlaceTienda` acepta más formas**: además de `_CustId_<dígitos>` (path) y el seller_id numérico directo, ahora también `?seller_id=<dígitos>` y `?CustId=<dígitos>` como parámetro de query — un link de nickname (`mercadolibre.com.co/pagina/<nombre>`) SÍ puede traer el seller_id real como query al llegar desde la ficha de un producto de esa tienda, como en el caso real reportado: `mercadolibre.com.co/pagina/tiendamercadomax?seller_id=456866397&item_id=MCO...` → `"456866397"`.

  **Verificado, ya se cumplía**: "mensaje de error visible si no reconoce el link" — `agregarSeguimientoAction` ya redirige con `?error=<mensaje>` y `page.tsx` ya lo renderiza con `<EstadoVacio>`, que desde el issue #186/#191 siempre es una caja oscura con texto claro (nunca depende del tema ni de dónde esté parada en la página) — no hacía falta ningún cambio ahí.

  **Nota para quien una los PRs**: el issue #192 (rama `fix-seguimiento-link-tienda-oficial`, pendiente de mergear, construida en paralelo) agrega `esLinkDeTienda`/`esLinkTiendaOficialSinIdDeVendedor` al mismo archivo para evitar que `interpretarEnlaceProducto` confunda un `item_id=` de un link de TIENDA con un producto real — esa protección todavía no cubre la forma nueva `?seller_id=` de este PR. Al mergear los dos, conviene sumar `[?&]seller_id=` al patrón `PATRON_LINK_TIENDA` de `esLinkDeTienda` en #192 para que la misma protección cubra también este formato.

  **Pruebas nuevas** (`lib/seguimiento/link.test.ts`): `interpretarEnlaceTienda` con el link real del bug (`?seller_id=`) y con `?CustId=` como query.

  **No se tocó**: ninguna migración, permiso, ni lógica de negocio — `components/marco/Ayuda.tsx` es un componente de marco nuevo, reutilizable, sin estado ni JS.

  Verificado: `npm run typecheck` en verde. `npm test`: 606 pruebas en verde (sin DB), mismos 23 archivos fallando solo por `DATABASE_URL_APP`/`DATABASE_URL_TRABAJADOR` ausentes en este entorno — ninguno nuevo por este cambio.
