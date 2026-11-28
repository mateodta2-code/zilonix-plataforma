import { llamarFalabellaCompleto } from "@/lib/falabella/cliente";
import { xmlImagenes, xmlProductCreate, type BorradorFalabella } from "@/lib/falabella/publicar-reglas";

// Fase 2: crear el producto en Falabella. Todo es asíncrono por feeds:
//   1. ProductCreate  → devuelve un FeedID
//   2. FeedStatus     → hasta "Finished" (o "Error", con el motivo por campo)
//   3. Image          → SOLO después de que el producto exista (otro FeedID)
//   4. FeedStatus     → de nuevo, para las imágenes
// Sin base de datos: quien llama (la UI) guarda el FeedID y lo consulta.
//
// PENDIENTE de confirmar con una cuenta real: stock en Bodega_envio_01 (la
// documentación de ProductCreate solo muestra un Stock dentro de
// BusinessUnit; si no cae en esa bodega, se hace con UpdateStock).

type Credenciales = { userId: string; apiKey: string; sellerId: string };

export type EstadoFeed = {
  feedId: string;
  estado: "en_cola" | "procesando" | "terminado" | "con_errores" | "cancelado" | "desconocido";
  total: number;
  procesados: number;
  fallidos: number;
  errores: string[];
};

export class BorradorConProblemasError extends Error {
  constructor(public readonly problemas: string[]) {
    super(`El borrador tiene problemas: ${problemas.join(" ")}`);
    this.name = "BorradorConProblemasError";
  }
}

function exigirFeedId(head: { RequestId?: string }, accion: string): string {
  if (!head.RequestId) throw new Error(`Falabella aceptó ${accion} pero no devolvió el FeedID para seguirlo.`);
  return head.RequestId;
}

export async function enviarProductCreate(cred: Credenciales, borrador: BorradorFalabella): Promise<string> {
  // Nunca se envía algo que la propia regla ya marcó como inválido.
  if (borrador.problemas.length) throw new BorradorConProblemasError(borrador.problemas);
  const { Head } = await llamarFalabellaCompleto<unknown>({ ...cred, action: "ProductCreate", version: "1.0", cuerpoXml: xmlProductCreate(borrador) });
  return exigirFeedId(Head, "ProductCreate");
}

export async function enviarImagenes(cred: Credenciales, sku: string, imagenes: string[]): Promise<string> {
  if (!sku.trim() || imagenes.length === 0) throw new Error("Falta el SKU o las imágenes.");
  const { Head } = await llamarFalabellaCompleto<unknown>({ ...cred, action: "Image", version: "1.0", cuerpoXml: xmlImagenes(sku, imagenes) });
  return exigirFeedId(Head, "Image");
}

const ESTADOS: Record<string, EstadoFeed["estado"]> = {
  Queued: "en_cola",
  Processing: "procesando",
  Finished: "terminado",
  Error: "con_errores",
  Canceled: "cancelado",
};

type DetalleFeed = {
  Feed?: string;
  Status?: string;
  TotalRecords?: string | number;
  ProcessedRecords?: string | number;
  FailedRecords?: string | number;
  FeedErrors?: { Error?: { Message?: string } | { Message?: string }[] } | "";
};

export function leerEstadoFeed(feedId: string, body: unknown): EstadoFeed {
  const d = ((body as { FeedDetail?: DetalleFeed } | null)?.FeedDetail ?? {}) as DetalleFeed;
  const errores = d.FeedErrors && typeof d.FeedErrors === "object" ? [d.FeedErrors.Error].flat().map((e) => String(e?.Message ?? "")).filter(Boolean) : [];
  const estado = ESTADOS[String(d.Status)] ?? "desconocido";
  const fallidos = Number(d.FailedRecords ?? 0) || 0;
  return {
    feedId,
    // Un feed "Finished" con registros fallidos no es un éxito.
    estado: estado === "terminado" && fallidos > 0 ? "con_errores" : estado,
    total: Number(d.TotalRecords ?? 0) || 0,
    procesados: Number(d.ProcessedRecords ?? 0) || 0,
    fallidos,
    errores: errores.slice(0, 10),
  };
}

// FeedID es un UUID: se valida antes de mandarlo a Falabella.
const PATRON_FEED_ID = /^[0-9a-f-]{8,64}$/i;

export async function consultarFeed(cred: Credenciales, feedId: string): Promise<EstadoFeed> {
  if (!PATRON_FEED_ID.test(feedId)) throw new Error("FeedID inválido.");
  const { Body } = await llamarFalabellaCompleto<unknown>({ ...cred, action: "FeedStatus", version: "1.0", parametros: { FeedID: feedId } });
  return leerEstadoFeed(feedId, Body);
}
