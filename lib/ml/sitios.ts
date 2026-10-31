// Issue #315 (Z-LATAM-01) — mapa puro de los sitios de Mercado Libre
// que Zilonix de verdad opera en LATAM: site_id real (lo que devuelve
// Mercado Libre en GET /users/me) → moneda (ISO 4217) e idioma/locale
// (BCP 47) de ese país. Nunca se le pregunta a Mercado Libre la moneda
// o el idioma por separado — se derivan de este mapa, una sola fuente
// de verdad, igual de cerrada que TIPOS_SIN_ESCRITURA_API en
// lib/ml/promociones.ts.
//
// Los 5 sitios vienen directo del criterio de aceptación del issue
// #315 (y del CHECK real en cuentas_ml, ver db/schema.ts/migración
// 0020) — agregar un país nuevo es: una fila más acá, el mismo valor
// en el CHECK, y una migración nueva (nunca editar la 0020 a mano).
export type SitioMl = {
  siteId: string;
  moneda: string;
  idioma: string;
  nombre: string;
};

export const SITIOS_ML: Readonly<Record<string, SitioMl>> = {
  MCO: { siteId: "MCO", moneda: "COP", idioma: "es-CO", nombre: "Colombia" },
  MLM: { siteId: "MLM", moneda: "MXN", idioma: "es-MX", nombre: "México" },
  MLB: { siteId: "MLB", moneda: "BRL", idioma: "pt-BR", nombre: "Brasil" },
  MLA: { siteId: "MLA", moneda: "ARS", idioma: "es-AR", nombre: "Argentina" },
  MLC: { siteId: "MLC", moneda: "CLP", idioma: "es-CL", nombre: "Chile" },
};

// Mismo default que la migración 0020 (columna site_id de cuentas_ml)
// — una sola fuente de verdad para "qué pasa si no sabemos el sitio".
export const SITE_ID_DEFECTO = "MCO";

export function esSiteIdValido(siteId: unknown): siteId is string {
  return typeof siteId === "string" && siteId in SITIOS_ML;
}

// Nunca lanza: un site_id que Mercado Libre mande y que todavía no
// esté en este mapa (un país nuevo que Zilonix no opera todavía) cae
// al default — nunca bloquea conectar una cuenta por esto.
export function datosSitioMl(siteId: unknown): SitioMl {
  if (esSiteIdValido(siteId)) return SITIOS_ML[siteId];
  return SITIOS_ML[SITE_ID_DEFECTO];
}
