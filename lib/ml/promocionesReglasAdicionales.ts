import { inArray } from "drizzle-orm";
import { dbComoEmpresa } from "@/db/empresa-context";
import { promocionesReglas } from "@/db/schema";
import { leerNombrePromocionMl, type PromocionCrudaMl } from "@/lib/ml/cliente";
import type { CandidatoCalculado } from "@/lib/ml/promociones";
import { evaluarReglasAdicionales, type EvaluacionReglasAdicionales } from "@/lib/ml/promocionesReglasAplicar";
import { validarReglasAdicionales, type ReglasAdicionales } from "@/lib/ml/promocionesReglasTexto";

// PR 2 de Promociones — la parte con base de datos / Mercado Libre de las
// «Reglas adicionales». La lógica de decisión vive en funciones puras
// (promocionesReglasAplicar.ts); acá solo se LEEN las reglas guardadas
// de cada cuenta y, SOLO si hace falta, el nombre de la promoción.

// JSON guardado por cuenta. Si el JSON guardado ya no valida (cambió el
// esquema, o se tocó a mano) se ignora y esa cuenta queda sin reglas
// adicionales — nunca se aplica algo que no pasa la validación.
export async function leerReglasAdicionalesCuentas(empresaId: string, cuentaIds: string[]): Promise<Map<string, ReglasAdicionales>> {
  const mapa = new Map<string, ReglasAdicionales>();
  if (cuentaIds.length === 0) return mapa;
  const filas = await dbComoEmpresa(empresaId, (tx) => tx.select().from(promocionesReglas).where(inArray(promocionesReglas.cuentaMlId, cuentaIds)));
  for (const fila of filas) {
    if (fila.reglasAdicionalesJson == null) continue;
    const v = validarReglasAdicionales(fila.reglasAdicionalesJson);
    if (v.ok) mapa.set(fila.cuentaMlId, v.reglas);
  }
  return mapa;
}

export type CacheNombresPromocion = Map<string, Promise<string | null>>;

function necesitaNombre(reglas: ReglasAdicionales): boolean {
  return reglas.exclusiones.some((e) => e.tipo === "nombre_promocion");
}

// Nombre real: el que ML mandó en la propia promoción, o —solo si las
// reglas lo necesitan y no vino— GET /seller-promotions/promotions/{id},
// una vez por promoción (caché). null = no se pudo leer (NO se adivina).
export async function nombreDePromocion(promo: PromocionCrudaMl, token: string, cache: CacheNombresPromocion): Promise<string | null> {
  if (typeof promo.name === "string" && promo.name.trim()) return promo.name;
  const id = typeof promo.id === "string" ? promo.id : "";
  const tipo = typeof promo.type === "string" ? promo.type : "";
  if (!id || !tipo) return null;
  const clave = `${tipo}:${id}`;
  let pendiente = cache.get(clave);
  if (!pendiente) {
    pendiente = leerNombrePromocionMl(id, tipo, token).catch(() => null);
    cache.set(clave, pendiente);
  }
  return pendiente;
}

// Evalúa una promoción ya calculada por el motor (con piso) contra las
// reglas adicionales de su cuenta. `promoCruda` es la misma promoción tal
// como la mandó ML (fechas y nombre).
export async function evaluarCandidatoConReglas(
  c: CandidatoCalculado,
  promoCruda: PromocionCrudaMl | undefined,
  reglas: ReglasAdicionales | null | undefined,
  token: string,
  cache: CacheNombresPromocion
): Promise<EvaluacionReglasAdicionales | null> {
  if (!reglas) return null;
  const nombre = promoCruda && necesitaNombre(reglas) ? await nombreDePromocion(promoCruda, token, cache) : promoCruda && typeof promoCruda.name === "string" ? promoCruda.name : null;
  return evaluarReglasAdicionales(reglas, {
    skuCodigo: c.skuCodigo,
    tipoPromocion: c.tipoPromocion,
    nombrePromocion: nombre,
    esCompartida: c.esCompartida,
    fechaInicio: typeof promoCruda?.start_date === "string" ? promoCruda.start_date : null,
    fechaFin: typeof promoCruda?.finish_date === "string" ? promoCruda.finish_date : null,
    precioOriginal: c.precioOriginal,
    precioSugerido: c.precioSugerido,
    precioMinimo: c.precioMinimo,
    maxDiscountedPrice: c.maxDiscountedPrice,
  });
}
