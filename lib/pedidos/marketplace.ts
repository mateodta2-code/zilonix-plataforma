import { formatearMoneda, formatearNumero, SITE_ID_DEFECTO, SITIOS_ML } from "@/lib/ml/sitios";

// Issue #422 — Pedidos muestra también los pedidos de Falabella. Lo puro
// (sin base ni React) vive acá para probarlo sin Postgres: qué filtro de
// marketplace pidió la URL, qué secciones se pintan, cómo se muestra el
// monto en la moneda real del pedido y qué productos trae el JSONB
// `items` que guarda lib/falabella/pedidos.ts.

export const PARAM_MARKETPLACE = "marketplace";

export const MARKETPLACES = [
  { valor: "todos", etiqueta: "Todos" },
  { valor: "ml", etiqueta: "Mercado Libre" },
  { valor: "falabella", etiqueta: "Falabella" },
] as const;

export type Marketplace = (typeof MARKETPLACES)[number]["valor"];

// Lista blanca: cualquier otra cosa que mande la URL es "todos".
export function parsearMarketplace(valor: string | string[] | undefined): Marketplace {
  const v = Array.isArray(valor) ? valor[0] : valor;
  return MARKETPLACES.some((m) => m.valor === v) ? (v as Marketplace) : "todos";
}

export function seccionesDeMarketplace(marketplace: Marketplace): { mercadoLibre: boolean; falabella: boolean } {
  return { mercadoLibre: marketplace !== "falabella", falabella: marketplace !== "ml" };
}

// formatearMoneda pide un site_id, no una moneda: se busca el sitio cuya
// moneda es la del pedido. Una moneda que no es de ningún sitio de
// SITIOS_ML (ej. PEN de Falabella Perú) nunca se pinta como COP: va el
// número con el agrupado por defecto y el código ISO al lado.
function sitioDeMoneda(moneda: string): string | null {
  return Object.values(SITIOS_ML).find((s) => s.moneda === moneda)?.siteId ?? null;
}

export function idiomaDeMoneda(moneda: string): string | undefined {
  const siteId = sitioDeMoneda(moneda);
  return siteId ? SITIOS_ML[siteId].idioma : undefined;
}

export function formatearMontoEnMoneda(valor: string | number, moneda: string): string {
  const numero = Number(valor);
  if (!Number.isFinite(numero)) return "—";
  const siteId = sitioDeMoneda(moneda);
  return siteId ? formatearMoneda(numero, siteId) : `${formatearNumero(numero, undefined)} ${moneda}`;
}

export type ProductoPedido = { nombre: string; sku: string | null };

// `items` es el detalle crudo de GetOrderItems (JSONB). Se lee a la
// defensiva: si una línea no trae Name o Sku, no se inventa nada.
export function productosDeItemsFalabella(items: unknown): ProductoPedido[] {
  if (!Array.isArray(items)) return [];
  return items.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const { Name, Sku } = item as { Name?: unknown; Sku?: unknown };
    const nombre = typeof Name === "string" && Name.trim() ? Name.trim() : null;
    const sku = typeof Sku === "string" && Sku.trim() ? Sku.trim() : null;
    if (!nombre && !sku) return [];
    return [{ nombre: nombre ?? "—", sku }];
  });
}

// Fecha y hora del pedido en el idioma del país de su moneda. La zona es
// la de Bogotá, la misma con la que resolverRangoVentas corta el mes —
// así un pedido de las 23:30 nunca sale con un día distinto al del filtro.
export function formatearFechaPedido(fecha: Date, moneda: string): string {
  return new Intl.DateTimeFormat(idiomaDeMoneda(moneda) ?? SITIOS_ML[SITE_ID_DEFECTO].idioma, {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "America/Bogota",
  }).format(fecha);
}
