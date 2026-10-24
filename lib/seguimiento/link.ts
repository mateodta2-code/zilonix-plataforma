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

export function interpretarEnlaceProducto(texto: string): EnlaceProductoInterpretado | null {
  const limpio = texto.trim();
  const catalogo = limpio.match(PATRON_CATALOGO);
  if (catalogo) return { recursoMl: "product", mlIdExterno: catalogo[1].toUpperCase() };
  const item = limpio.match(PATRON_ITEM_O_PRODUCTO);
  if (item) return { recursoMl: "item", mlIdExterno: `MCO${item[1]}` };
  return null;
}

// Para una tienda: el seller_id numérico directo, o extraído de un
// link con "_CustId_{numero}" (confirmado en producción,
// listado.mercadolibre.com.co/_CustId_123456...). Un link con nickname
// en vez de _CustId_ (ej. mercadolibre.com.co/pagina/unatienda) no se
// soporta todavía — resolver un nickname a seller_id real necesitaría
// una llamada a Mercado Libre que todavía no está confirmada, nunca se
// adivina.
const PATRON_CUST_ID = /_CustId_(\d+)/i;
const PATRON_SOLO_DIGITOS = /^\d+$/;

export function interpretarEnlaceTienda(texto: string): string | null {
  const limpio = texto.trim();
  if (PATRON_SOLO_DIGITOS.test(limpio)) return limpio;
  const custId = limpio.match(PATRON_CUST_ID);
  return custId ? custId[1] : null;
}
