// Reclamos-Dinero (Refs #646) — acciones que MUEVEN DINERO sobre un
// reclamo: reembolso parcial/total, ofrecer devolución y pedir
// mediación. Solo APIs documentadas de post-purchase v1. Cada función
// de escritura valida ANTES de llamar a ML (reclamo abierto, acción
// disponible para el vendedor, porcentaje dentro de available-offers):
// si algo no cuadra, no se llama a Mercado Libre. La relectura del
// reclamo justo antes de escribir la hace la server action.

import { accionesDelVendedor, leerReclamoMl, PATRON_ID_RECLAMO, type ReclamoBaseMl } from "@/lib/ml/reclamos";
import { escribirMl, idTexto, pedirLecturaMl, textoODefecto } from "@/lib/ml/cliente";

const BASE_ML = "https://api.mercadolibre.com";

export type AccionDinero = "reembolso_parcial" | "reembolso_total" | "devolucion" | "mediacion";

// Acción de available_actions que habilita cada botón. La devolución
// acepta cualquiera de las variantes que documenta ML.
const ACCIONES_REQUERIDAS: Record<AccionDinero, string[]> = {
  reembolso_parcial: ["allow_partial_refund"],
  reembolso_total: ["refund"],
  devolucion: ["allow_return", "allow_return_label"],
  mediacion: ["open_dispute"],
};

export type OfertaReembolso = { porcentaje: number; monto: number | null };
export type OfertasReembolso = { moneda: string | null; ofertas: OfertaReembolso[] };

// ---------- Funciones puras ----------

// Reclamo de producto distinto o defectuoso (PDD): los motivos de ML
// empiezan con «PDD» (ej. PDD9939). El reembolso parcial solo existe ahí.
export function esReclamoPdd(reclamo: ReclamoBaseMl): boolean {
  return typeof reclamo.motivoId === "string" && reclamo.motivoId.toUpperCase().startsWith("PDD");
}

// null = la acción se puede intentar; texto = motivo (en español simple)
// por el que el botón queda deshabilitado y no se llama a ML.
export type DatosDisponibilidad = { estado: string | null; motivoId: string | null; acciones: string[] };

export function motivoNoDisponiblePorDatos(d: DatosDisponibilidad, accion: AccionDinero): string | null {
  if (d.estado !== "opened") return "El reclamo ya no está abierto.";
  if (!ACCIONES_REQUERIDAS[accion].some((a) => d.acciones.includes(a))) return "Mercado Libre no habilita esta acción para este reclamo ahora.";
  const pdd = typeof d.motivoId === "string" && d.motivoId.toUpperCase().startsWith("PDD");
  if (accion === "reembolso_parcial" && !pdd) return "El reembolso parcial solo aplica a reclamos por producto distinto o defectuoso.";
  if (accion === "devolucion" && !pdd) return "Ofrecer devolución solo aplica a reclamos por producto distinto o defectuoso.";
  return null;
}

export function motivoAccionNoDisponible(reclamo: ReclamoBaseMl, accion: AccionDinero): string | null {
  return motivoNoDisponiblePorDatos({ estado: reclamo.estado, motivoId: reclamo.motivoId, acciones: accionesDelVendedor(reclamo.jugadores) }, accion);
}

function numeroOnull(v: unknown): number | null {
  const n = typeof v === "string" ? Number(v) : v;
  return typeof n === "number" && Number.isFinite(n) ? n : null;
}

// GET …/partial-refund/available-offers. La forma exacta no está
// confirmada en producción: se aceptan una lista o un objeto con la
// lista, y los campos percentage/amount. Lo que no se reconoce se
// descarta (nunca se inventa un porcentaje).
export function leerOfertasReembolsoParcialMl(data: unknown): OfertasReembolso {
  const objeto = data && typeof data === "object" && !Array.isArray(data) ? (data as Record<string, unknown>) : {};
  const lista = Array.isArray(data) ? data : Array.isArray(objeto.available_offers) ? objeto.available_offers : Array.isArray(objeto.offers) ? objeto.offers : [];
  let moneda = textoODefecto(objeto.currency_id) ?? textoODefecto(objeto.currency);
  const vistos = new Set<number>();
  const ofertas: OfertaReembolso[] = [];
  for (const o of lista) {
    if (!o || typeof o !== "object") continue;
    const fila = o as Record<string, unknown>;
    const porcentaje = numeroOnull(fila.percentage ?? fila.percent);
    if (porcentaje === null || porcentaje <= 0 || porcentaje >= 100 || vistos.has(porcentaje)) continue;
    vistos.add(porcentaje);
    moneda = moneda ?? textoODefecto(fila.currency_id);
    ofertas.push({ porcentaje, monto: numeroOnull(fila.amount) });
  }
  ofertas.sort((a, b) => a.porcentaje - b.porcentaje);
  return { moneda, ofertas };
}

// El porcentaje se manda con un decimal, como documenta ML («50.0»).
export function valorPorcentaje(porcentaje: number): string {
  return Number.isInteger(porcentaje) ? `${porcentaje}.0` : String(porcentaje);
}

// ---------- Lecturas ----------

// Relectura del reclamo (GET) justo antes de escribir. null = no existe.
export async function leerReclamoParaEscribirMl(reclamoId: string, token: string): Promise<ReclamoBaseMl | null> {
  if (!PATRON_ID_RECLAMO.test(reclamoId)) return null;
  const resp = await pedirLecturaMl<unknown>(`/post-purchase/v1/claims/${reclamoId}`, token);
  return resp.ok ? leerReclamoMl(resp.data) : null;
}

export async function obtenerOfertasReembolsoParcialMl(reclamoId: string, token: string): Promise<OfertasReembolso | null> {
  if (!PATRON_ID_RECLAMO.test(reclamoId)) return null;
  const resp = await pedirLecturaMl<unknown>(`/post-purchase/v1/claims/${reclamoId}/partial-refund/available-offers`, token);
  return resp.ok ? leerOfertasReembolsoParcialMl(resp.data) : null;
}

// ---------- Escrituras ----------

export type ResultadoEscrituraDinero = {
  // false con status 0 = no se llamó a ML (validación) o falló la red.
  ok: boolean;
  status: number;
  // true solo si de verdad se hizo la petición a ML.
  llamado: boolean;
  motivo: string | null;
  textoCrudo: string;
};

function sinLlamar(motivo: string): ResultadoEscrituraDinero {
  return { ok: false, status: 0, llamado: false, motivo, textoCrudo: "" };
}

async function escribirResolucion(ruta: string, token: string, metodo: "POST" | "PUT", cuerpo: Record<string, unknown>): Promise<ResultadoEscrituraDinero> {
  const r = await escribirMl<unknown>(`${BASE_ML}${ruta}`, token, metodo, cuerpo);
  return { ok: r.ok, status: r.status, llamado: true, motivo: null, textoCrudo: r.textoCrudo };
}

function validarBase(reclamo: ReclamoBaseMl, accion: AccionDinero): string | null {
  if (!PATRON_ID_RECLAMO.test(reclamo.id)) return "Reclamo inválido.";
  return motivoAccionNoDisponible(reclamo, accion);
}

// Reembolso parcial: solo PDD, con allow_partial_refund, y solo un
// porcentaje que ML devolvió en available-offers.
export async function ofrecerReembolsoParcialMl(reclamo: ReclamoBaseMl, porcentaje: number, ofertas: OfertasReembolso, token: string): Promise<ResultadoEscrituraDinero> {
  const motivo = validarBase(reclamo, "reembolso_parcial");
  if (motivo) return sinLlamar(motivo);
  if (!ofertas.ofertas.some((o) => o.porcentaje === porcentaje)) return sinLlamar("Ese porcentaje no es una de las ofertas de Mercado Libre.");
  return escribirResolucion(`/post-purchase/v1/claims/${reclamo.id}/expected_resolutions`, token, "POST", {
    expected_resolution: "allow_partial_refund",
    detail: { key: "percentage", value: valorPorcentaje(porcentaje) },
  });
}

export async function reembolsoTotalMl(reclamo: ReclamoBaseMl, token: string): Promise<ResultadoEscrituraDinero> {
  const motivo = validarBase(reclamo, "reembolso_total");
  if (motivo) return sinLlamar(motivo);
  return escribirResolucion(`/post-purchase/v1/claims/${reclamo.id}/expected-resolutions/refund`, token, "POST", {});
}

export async function ofrecerDevolucionMl(reclamo: ReclamoBaseMl, token: string): Promise<ResultadoEscrituraDinero> {
  const motivo = validarBase(reclamo, "devolucion");
  if (motivo) return sinLlamar(motivo);
  return escribirResolucion(`/post-purchase/v1/claims/${reclamo.id}/expected_resolutions`, token, "POST", { expected_resolution: "return_product" });
}

export async function pedirMediacionMl(reclamo: ReclamoBaseMl, token: string): Promise<ResultadoEscrituraDinero> {
  const motivo = validarBase(reclamo, "mediacion");
  if (motivo) return sinLlamar(motivo);
  return escribirResolucion(`/post-purchase/v1/claims/${reclamo.id}`, token, "PUT", { stage: "dispute" });
}

// Solo para el aviso al usuario: id de la venta del reclamo.
export function ordenDelReclamo(reclamo: ReclamoBaseMl): string | null {
  return reclamo.recurso === "order" ? idTexto(reclamo.recursoId) : null;
}
