// Reclamos-Dinero (Refs #646) — «Revisar devolución»: cuando el producto
// devuelto llega, el vendedor dice si llegó bien o con problemas. Solo
// APIs documentadas de post-purchase (returns). Igual que las demás
// acciones de dinero: valida antes de llamar y no llama si algo no cuadra.
// Pendiente de confirmar en staging con la devolución real de Mateo: la
// forma exacta del cuerpo de return-review y los nombres de acción
// (return_review_ok / return_review_fail) salen de la documentación, no
// de un caso ya corrido en producción.

import { accionesDelVendedor, PATRON_ID_RECLAMO, type ReclamoBaseMl } from "@/lib/ml/reclamos";
import { escribirMl, idTexto, pedirLecturaMl, textoODefecto } from "@/lib/ml/cliente";

const BASE_ML = "https://api.mercadolibre.com";
const PATRON_ID_DEVOLUCION = /^\d{1,20}$/;
const PATRON_ID_MOTIVO = /^[A-Za-z0-9_-]{1,40}$/;
const PATRON_ARCHIVO = /^[A-Za-z0-9][A-Za-z0-9._-]{0,199}$/;
export const LARGO_MAXIMO_DETALLE_REVISION = 350;

export type ResultadoRevision = "ok" | "con_falla";
export type MotivoFallaDevolucion = { id: string; nombre: string };

const ACCION_REQUERIDA: Record<ResultadoRevision, string> = { ok: "return_review_ok", con_falla: "return_review_fail" };

export function motivoRevisionNoDisponible(reclamo: ReclamoBaseMl, resultado: ResultadoRevision): string | null {
  if (reclamo.estado !== "opened") return "El reclamo ya no está abierto.";
  if (!accionesDelVendedor(reclamo.jugadores).includes(ACCION_REQUERIDA[resultado])) return "Mercado Libre no habilita revisar esta devolución ahora.";
  return null;
}

// GET /post-purchase/v1/returns/reasons?flow=seller_return_failed&claim_id=…
export function leerMotivosFallaDevolucionMl(data: unknown): MotivoFallaDevolucion[] {
  const lista = Array.isArray(data) ? data : Array.isArray((data as { reasons?: unknown })?.reasons) ? (data as { reasons: unknown[] }).reasons : [];
  return lista.flatMap((m): MotivoFallaDevolucion[] => {
    if (!m || typeof m !== "object") return [];
    const fila = m as Record<string, unknown>;
    const id = typeof fila.id === "string" ? fila.id : idTexto(fila.id);
    const nombre = textoODefecto(fila.name) ?? textoODefecto(fila.detail) ?? textoODefecto(fila.description);
    return id && PATRON_ID_MOTIVO.test(id) && nombre ? [{ id, nombre }] : [];
  });
}

export async function obtenerMotivosFallaDevolucionMl(reclamoId: string, token: string): Promise<MotivoFallaDevolucion[]> {
  if (!PATRON_ID_RECLAMO.test(reclamoId)) return [];
  const resp = await pedirLecturaMl<unknown>("/post-purchase/v1/returns/reasons", token, { query: `?flow=seller_return_failed&claim_id=${reclamoId}` });
  return resp.ok ? leerMotivosFallaDevolucionMl(resp.data) : [];
}

export type EntradaRevision = {
  resultado: ResultadoRevision;
  devolucionId: string;
  ordenId: string | null;
  motivoId?: string;
  mensaje?: string;
  // Nombres de archivo que ML devolvió al subir la evidencia.
  adjuntos?: string[];
};

export type ResultadoEscrituraRevision = { ok: boolean; status: number; llamado: boolean; motivo: string | null; textoCrudo: string };

function sinLlamar(motivo: string): ResultadoEscrituraRevision {
  return { ok: false, status: 0, llamado: false, motivo, textoCrudo: "" };
}

// POST /post-purchase/v1/returns/{return_id}/return-review
export async function revisarDevolucionMl(reclamo: ReclamoBaseMl, entrada: EntradaRevision, motivosValidos: MotivoFallaDevolucion[], token: string): Promise<ResultadoEscrituraRevision> {
  if (!PATRON_ID_RECLAMO.test(reclamo.id) || !PATRON_ID_DEVOLUCION.test(entrada.devolucionId)) return sinLlamar("Devolución inválida.");
  const noDisponible = motivoRevisionNoDisponible(reclamo, entrada.resultado);
  if (noDisponible) return sinLlamar(noDisponible);

  const orden: Record<string, unknown> = { status: entrada.resultado === "ok" ? "ok" : "failed" };
  if (entrada.ordenId && PATRON_ID_DEVOLUCION.test(entrada.ordenId)) orden.order_id = entrada.ordenId;
  if (entrada.resultado === "con_falla") {
    if (!entrada.motivoId || !motivosValidos.some((m) => m.id === entrada.motivoId)) return sinLlamar("Elige uno de los motivos que ofrece Mercado Libre.");
    const mensaje = (entrada.mensaje ?? "").trim();
    if (!mensaje || mensaje.length > LARGO_MAXIMO_DETALLE_REVISION) return sinLlamar(`Cuenta qué pasó (máximo ${LARGO_MAXIMO_DETALLE_REVISION} caracteres).`);
    const adjuntos = entrada.adjuntos ?? [];
    if (adjuntos.some((a) => !PATRON_ARCHIVO.test(a) || a.includes(".."))) return sinLlamar("Adjunto inválido.");
    orden.reason_id = entrada.motivoId;
    orden.message = mensaje;
    if (adjuntos.length > 0) orden.attachments = adjuntos;
  }
  const r = await escribirMl<unknown>(`${BASE_ML}/post-purchase/v1/returns/${entrada.devolucionId}/return-review`, token, "POST", { orders: [orden] });
  return { ok: r.ok, status: r.status, llamado: true, motivo: null, textoCrudo: r.textoCrudo };
}
