// Tarea 2.11 ("Publicar producto y clip") — formas de datos compartidas
// entre el esquema (db/schema.ts) y la lógica real (lib/ml/publicar-
// reglas.ts, lib/ml/publicar.ts). Archivo sin ningún import de db/ a
// propósito (igual que lib/cifrado.ts con TokenCifrado) para que
// db/schema.ts pueda importar de acá sin crear un ciclo.
//
// Todo lo documentado acá viene de la investigación real contra
// zilonix-os-web/lib/mercadolibre-publicar.js (1555 líneas, leído
// completo) — no inventado. Mateo pidió portar el 100% de las reglas
// reales, sin recortar alcance.

export type DimensionesProducto = {
  peso?: string; // gramos
  largo?: string; // cm
  ancho?: string; // cm
  alto?: string; // cm
};

export type ImagenProducto = { url: string };

// Título/descripción/portada son por cuenta (reunión 31/8) — nunca "uno
// por defecto" compartido entre cuentas propias.
export type DatosPorCuenta = {
  titulo?: string;
  descripcion?: string;
  portadaUrl?: string | null;
  portadasPorVariante?: Record<string, string>; // { [valorEjeFoto]: url }
};

export type CombinacionVariante = {
  valores: Record<string, string>; // { [attrIdEje]: valor }
  sku?: string;
  stock?: number;
  precio?: number;
};

export type VariantesProducto = {
  ejes: string[]; // IDs de atributo usados como eje (ej. TALLA, COLOR)
  ejeFoto: string | null; // cuál eje admite portada propia (defines_picture)
  combinaciones: CombinacionVariante[];
};

// Definición real de un atributo de categoría, tal como la devuelve
// GET /categories/{id}/attributes.
export type ValorAtributoMl = { id?: string; name: string };
export type DefinicionAtributoMl = {
  id: string;
  name: string;
  value_type?: string | null;
  values?: ValorAtributoMl[];
  tags?: {
    required?: boolean;
    catalog_required?: boolean;
    allow_variations?: boolean;
    defines_picture?: boolean;
    hidden?: boolean;
    read_only?: boolean;
  };
};

export type AtributoAsumido = { id: string; nombre: string; valorAsumido: string };

export type ResultadoPublicacionExito = {
  cuentaMlId: string;
  ok: true;
  itemId: string;
  permalink: string;
  categoria: string;
  atributosAsumidos: AtributoAsumido[];
  status: string;
  modoPrueba: boolean;
  avisoFotosVariante: string | null;
  avisoMarca: string | null;
  avisoDescripcion: string | null;
};

export type ResultadoPublicacionFallo = {
  cuentaMlId: string;
  ok: false;
  categoria?: string;
  error: string;
  // El body exacto que se mandó a Mercado Libre — herramienta principal
  // de diagnóstico (ver §3.18 del reporte de investigación). Nunca se
  // pierde en un fallo.
  bodyEnviado?: unknown;
};

export type ResultadoFamiliaItem = {
  valores: Record<string, string>;
  sku?: string;
  ok: boolean;
  itemId?: string;
  permalink?: string;
  status?: string;
  error?: string;
};

export type ResultadoPublicacionFamilia = {
  cuentaMlId: string;
  ok: boolean;
  categoria?: string;
  familia: { familyName: string; items: ResultadoFamiliaItem[] };
  error?: string;
};

export type ResultadoPublicacionCuenta = ResultadoPublicacionExito | ResultadoPublicacionFallo | ResultadoPublicacionFamilia;

export const LISTING_TYPE_POR_DEFECTO = "gold_pro"; // Premium — regla de negocio fija (reunión 31/8)
