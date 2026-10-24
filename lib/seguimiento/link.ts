// Issue #175 — interpreta lo que alguien pega en el formulario de
// "agregar seguimiento": un link real de Mercado Libre o el id/seller_id
// directo. Nunca llama a Mercado Libre acá (es puro parseo de texto) —
// la resolución real (nombre, precio) la hace lib/seguimiento/seguimientos.ts
// con las funciones ya existentes de lib/ml/cliente.ts.
//
// Formatos confirmados en producción (zilonix-os-web) para una
// publicación/producto: articulo.mercadolibre.com.co/MCO-123456789
// (publicación) y .../p/MCO123456789 (producto de catálogo, con "/p/"
// antes del id) — las dos formas comparten el mismo "MCO" + dígitos,
// la diferencia real es la presencia de "/p/" antes.
export type RecursoMlProducto = "item" | "product";
export type EnlaceProductoInterpretado = { recursoMl: RecursoMlProducto; mlIdExterno: string };

const PATRON_CATALOGO = /\/p\/(MCO\d+)/i;
const PATRON_ITEM_O_PRODUCTO = /MCO-?(\d+)/i;

// Issue #192, bug real: un link de tienda oficial real
// (.../tienda/colchones-relax?item_id=MCO1657640131&...) trae un
// "item_id" en el query que PATRON_ITEM_O_PRODUCTO (abajo) reconocía
// igual que el id de una publicación real — con tipo "Producto"
// seleccionado, interpretarEnlaceProducto agregaba ESE item_id al
// seguimiento como si la persona hubiera pegado el link de esa
// publicación, nunca el de la tienda que de verdad quería seguir, sin
// ningún error. Mismos patrones que tipoDePagina en la extensión
// (extension/lectores/mercadolibre.js) reconoce como "tienda" — un
// link que matchea ACÁ nunca es un link de producto, sin importar qué
// más traiga en el query.
const PATRON_LINK_TIENDA = /\/tienda\/|tienda\.mercadolibre|_CustId_|[?&]CustId=/i;

export function esLinkDeTienda(texto: string): boolean {
  return PATRON_LINK_TIENDA.test(texto.trim());
}

export function interpretarEnlaceProducto(texto: string): EnlaceProductoInterpretado | null {
  const limpio = texto.trim();
  if (esLinkDeTienda(limpio)) return null;
  const catalogo = limpio.match(PATRON_CATALOGO);
  if (catalogo) return { recursoMl: "product", mlIdExterno: catalogo[1].toUpperCase() };
  const item = limpio.match(PATRON_ITEM_O_PRODUCTO);
  if (item) return { recursoMl: "item", mlIdExterno: `MCO${item[1]}` };
  return null;
}

// Para una tienda: el seller_id numérico directo, o extraído de un
// link con "_CustId_{numero}" (confirmado en producción,
// listado.mercadolibre.com.co/_CustId_123456...) o "?CustId=123456"
// (issue #192 — la misma forma clásica que ya reconoce la extensión,
// extraerCustIdDeUrl en extension/lectores/mercadolibre.js, issue
// #188). Un link con nickname en vez de CustId (ej.
// mercadolibre.com.co/pagina/unatienda) no se soporta todavía —
// resolver un nickname a seller_id real necesitaría una llamada a
// Mercado Libre que todavía no está confirmada, nunca se adivina.
//
// Issue #192, bug real: un link de tienda OFICIAL
// (.../tienda/colchones-relax?...&official_store_id=53573&...) no
// trae ninguno de los dos — official_store_id es el id de la TIENDA
// OFICIAL, un concepto distinto de seller_id en el modelo de Mercado
// Libre (pueden coincidir o no) — NUNCA se adivina que son el mismo
// número. Sigue devolviendo null en ese caso (nunca inventa un id);
// esLinkTiendaOficialSinIdDeVendedor (abajo) solo distingue ESE caso
// puntual para que agregarSeguimiento (lib/seguimiento/seguimientos.ts)
// pueda dar un mensaje de error más claro que "no reconocemos esto".
const PATRON_CUST_ID = /_CustId_(\d+)|[?&]CustId=(\d+)/i;
const PATRON_SOLO_DIGITOS = /^\d+$/;

export function interpretarEnlaceTienda(texto: string): string | null {
  const limpio = texto.trim();
  if (PATRON_SOLO_DIGITOS.test(limpio)) return limpio;
  const custId = limpio.match(PATRON_CUST_ID);
  return custId ? custId[1] ?? custId[2] : null;
}

const PATRON_OFFICIAL_STORE_ID = /[?&]official_store_id=/i;

// Solo para elegir el mensaje de error correcto en
// agregarSeguimiento — nunca se usa para extraer ningún id.
export function esLinkTiendaOficialSinIdDeVendedor(texto: string): boolean {
  const limpio = texto.trim();
  if (interpretarEnlaceTienda(limpio)) return false; // ya se pudo resolver un id real, no es este caso
  return PATRON_LINK_TIENDA.test(limpio) && PATRON_OFFICIAL_STORE_ID.test(limpio);
}
