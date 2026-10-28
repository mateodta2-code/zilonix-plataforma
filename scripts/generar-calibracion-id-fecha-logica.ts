// Issue #262 (revisión de Pablo, punto BLOQUEANTE) — lógica PURA (sin
// Postgres) de scripts/generar-calibracion-id-fecha.ts, separada en
// este archivo para poder probarla sin DATABASE_URL_APP — mismo
// criterio que scripts/comparar-conteos-logica.ts (el script con
// main() nunca se importa desde una prueba, para no disparar
// conexiones reales solo por hacer `import`).
import { obtenerFechaCreacion, obtenerFechaCreacionCatalogo } from "@/lib/seguimiento/alertas";

export type Punto = { id: string; tipo: "item" | "product"; fecha: string };
export type DecisionPuntoCompetidor = { punto: Punto | null; omitido: boolean };

export function prefijoDeId(id: string): string | null {
  const m = id.match(/^([A-Z]{3})\d+$/);
  return m ? m[1] : null;
}

// Bug real que esto evita: para recurso_ml "product" (catálogo),
// `seguimiento_fotos.publicaciones.fechaCreacion` venía del ÍTEM
// GANADOR de ese catálogo (obtenerOfertasProducto, lib/seguimiento/lector.ts)
// — el date_created de la publicación de UN vendedor cualquiera, nunca
// el del catálogo en sí. Usarlo como antigüedad de catálogo hubiera
// calibrado la tabla con fechas de ítems ajenos disfrazadas de fechas
// de catálogo. Corregido en 2 frentes: `fechaCreacion` ahora SIEMPRE
// null para "product" (lector.ts ya no la guarda ahí) — esta función,
// de todas formas, NUNCA la lee para "product" (por si quedó alguna
// fila vieja, de antes de ese fix, con un valor real ahí — el test
// cubre justo ese caso); y el date_created REAL del catálogo ahora
// sale de `fechaCreacionCatalogo` (issue #262, punto 2 —
// resolverNombreYFechaCatalogo, GET /products/{id}, nunca una oferta
// ganadora).
export function decidirPuntoCompetidor(mlIdExterno: string, recursoMl: "item" | "product", fotos: Array<{ publicaciones: unknown }>): DecisionPuntoCompetidor {
  if (recursoMl === "item") {
    // Cualquier foto con la fecha confirmada alcanza — todas deberían
    // traer la MISMA fecha real una vez que la API la confirma una
    // vez (date_created de una publicación no cambia).
    const fecha = fotos.map((f) => obtenerFechaCreacion(f.publicaciones)).find((f): f is string => f != null);
    return { punto: fecha ? { id: mlIdExterno, tipo: "item", fecha } : null, omitido: false };
  }
  // recursoMl === "product" — NUNCA lee `fechaCreacion` (sería la del
  // ítem ganador, no del catálogo) — solo `fechaCreacionCatalogo`.
  const fechaCatalogo = fotos.map((f) => obtenerFechaCreacionCatalogo(f.publicaciones)).find((f): f is string => f != null);
  if (fechaCatalogo) return { punto: { id: mlIdExterno, tipo: "product", fecha: fechaCatalogo }, omitido: false };
  // "omitido: fecha de ítem ganador, no de catálogo" — el motivo
  // original de este bloqueante; hoy, con fechaCreacionCatalogo ya
  // separado, el caso real más común es simplemente "todavía no se
  // resolvió" (resolverNombreYFechaCatalogo solo corre mientras el
  // nombre siga pendiente) — se cuenta igual como omitido, nunca se
  // rellena con la fecha equivocada.
  return { punto: null, omitido: true };
}

// Fuente 2 — publicaciones propias: una publicación ÉXITO de
// `productos_ml.resultado[]` (su propio itemId) emparejada con
// `publicado_ts` (el instante en que Zilonix la publicó, prácticamente
// el mismo que el date_created real de Mercado Libre para ese item).
export function puntoDePropia(itemId: unknown, publicadoTs: Date | null): Punto | null {
  if (typeof itemId !== "string" || !publicadoTs) return null;
  return { id: itemId, tipo: "item", fecha: publicadoTs.toISOString() };
}

export function esResultadoExito(r: unknown): r is { ok: true; itemId: string } {
  return Boolean(r) && typeof r === "object" && "ok" in (r as object) && (r as { ok: unknown }).ok === true && typeof (r as { itemId?: unknown }).itemId === "string";
}
