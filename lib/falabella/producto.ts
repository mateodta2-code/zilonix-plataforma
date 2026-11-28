import { llamarFalabella } from "@/lib/falabella/cliente";

// Estado REAL de un producto ya creado en Falabella (GetProducts por SKU).
// Campos confirmados en developers.falabella.com (GetProducts): Url, QCStatus,
// MainImage y, dentro de BusinessUnits, IsPublished/Status/Stock/Price/SalePrice.
// La forma exacta del JSON no está confirmada con cuenta real: lector defensivo.

type Credenciales = { userId: string; apiKey: string; sellerId: string };

export type ProductoFalabella = {
  url: string | null;
  qcStatus: string | null; // pending | approved | rejected
  publicado: boolean | null; // IsPublished
  estadoVenta: string | null; // active | inactive | deleted
  stock: number | null;
  precio: number | null;
  precioOferta: number | null;
};

function lista<T>(v: T | T[] | undefined | null): T[] {
  return v === undefined || v === null ? [] : Array.isArray(v) ? v : [v];
}

const texto = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);
const numero = (v: unknown) => (v !== "" && v != null && Number.isFinite(Number(v)) ? Number(v) : null);

export function leerProducto(body: unknown, sku: string): ProductoFalabella | null {
  const productos = lista((body as { Products?: { Product?: unknown } } | null)?.Products?.Product) as Record<string, unknown>[];
  const p = productos.find((x) => String(x?.SellerSku ?? "") === sku) ?? productos[0];
  if (!p) return null;
  const unidades = lista((p.BusinessUnits as { BusinessUnit?: unknown } | undefined)?.BusinessUnit) as Record<string, unknown>[];
  const u = unidades.find((x) => String(x?.OperatorCode ?? "").toLowerCase() === "faco") ?? unidades[0] ?? {};
  const publicado = u.IsPublished ?? u.isPublished;
  return {
    url: texto(p.Url),
    qcStatus: texto(p.QCStatus),
    publicado: publicado === undefined ? null : publicado === 1 || publicado === "1" || publicado === true,
    estadoVenta: texto(u.Status),
    stock: numero(u.Stock),
    precio: numero(u.Price),
    precioOferta: numero(u.SalePrice ?? u.SpecialPrice),
  };
}

export async function consultarProducto(cred: Credenciales, sku: string): Promise<ProductoFalabella | null> {
  const body = await llamarFalabella({ ...cred, action: "GetProducts", version: "1.0", parametros: { SkuSellerList: JSON.stringify([sku]) } });
  return leerProducto(body, sku);
}
