import { rm } from "fs/promises";
import { conConcurrenciaLimitada } from "@/lib/concurrencia";
import { obtenerAccessTokenVigente } from "@/lib/ml/cuentas";
import {
  ClipDemasiadoGrandeError,
  ClipInvalidoError,
  ClipReputacionRequeridaError,
  ClipSinRespuestaError,
  subirClipItemDesdeArchivo,
} from "@/lib/ml/clip";

// Rama feat-publicar-clip, punto 4 ("Subida") — "No cargues 280MB en
// memoria... desde ahí se lanza un trabajo en lib/trabajos/ que sube a
// cada cuenta marcada... de forma secuencial o con concurrencia de 2".
// Mismo criterio real que ya usa crearYPublicarProductoAction
// (app/panel/publicar/actions.ts): el servidor de Railway es un
// proceso Node PERSISTENTE (nunca serverless), así que una promesa que
// arranca sin esperarla (sin `await`) sigue corriendo después de que
// la petición HTTP ya respondió.
//
// Punto 5 del pedido — "Sin tabla nueva por ahora: el historial
// persistente queda para la migración de la Parte 4" — el estado del
// trabajo vive en un Map EN MEMORIA, a propósito. Límite real y
// aceptado (documentado, no silencioso): si el proceso de Railway se
// reinicia (deploy, caída) mientras un trabajo está corriendo, ese
// trabajo se pierde — el video YA subido a las cuentas que llegaron a
// terminar queda subido igual (eso lo hizo Mercado Libre, no esto),
// pero el seguimiento de progreso de esta sesión del navegador se
// pierde. Aceptable para esta tarea: la migración de la Parte 4 es
// quien le da persistencia real.

export type EstadoCuentaClip = "en_cola" | "subiendo" | "en_moderacion" | "publicado" | "rechazado" | "error";

export type ProgresoCuentaClip = {
  cuentaId: string;
  nickname: string;
  itemId: string;
  estado: EstadoCuentaClip;
  error: string | null;
  clipUuid: string | null;
};

export type TrabajoClip = {
  id: string;
  empresaId: string;
  creadoTs: number;
  terminadoTs: number | null;
  cuentas: ProgresoCuentaClip[];
};

// Entrada para iniciar el trabajo — cada cuenta puede traer su PROPIO
// archivo (punto 3 del pedido, "usar otro video para esta cuenta"); si
// no trae el suyo, usa `rutaArchivoPorDefecto`/`contentTypePorDefecto`
// (el mismo video para todas, el caso normal).
export type CuentaParaSubirClip = {
  cuentaId: string;
  nickname: string;
  itemId: string;
  rutaArchivo?: string;
  contentType?: string;
};

const CONCURRENCIA_SUBIDA_CLIP = 2;
// Tope de seguridad — un trabajo "fantasma" (el proceso se reinició, o
// algo quedó colgado) no se queda en el Map para siempre; se poda cada
// vez que se crea uno nuevo (nunca un cron aparte solo para esto).
const TOPE_EDAD_TRABAJO_MS = 2 * 60 * 60 * 1000; // 2h — de sobra para subir hasta 20 cuentas con concurrencia 2

const trabajos = new Map<string, TrabajoClip>();

function podarTrabajosViejos(): void {
  const ahora = Date.now();
  for (const [id, trabajo] of trabajos) {
    if (ahora - trabajo.creadoTs > TOPE_EDAD_TRABAJO_MS) trabajos.delete(id);
  }
}

// Mapea cada error tipado de lib/ml/clip.ts a un mensaje real, nunca el
// texto crudo de Mercado Libre expuesto sin filtrar a la UI (ese texto
// completo, hasta 800 caracteres, ya se logueó aparte dentro de
// subirClipItemDesdeArchivo/subirClipMl si hiciera falta depurar).
function mensajeDeErrorSubida(error: unknown): string {
  if (error instanceof ClipReputacionRequeridaError) return error.message;
  if (error instanceof ClipSinRespuestaError) return error.message;
  if (error instanceof ClipDemasiadoGrandeError) return error.message;
  if (error instanceof ClipInvalidoError) return error.message;
  if (error instanceof Error) return error.message.slice(0, 400);
  return "No se pudo subir el Clip — intentá de nuevo.";
}

async function subirAUnaCuenta(empresaId: string, cuenta: CuentaParaSubirClip, rutaPorDefecto: string, contentTypePorDefecto: string, fila: ProgresoCuentaClip): Promise<void> {
  fila.estado = "subiendo";
  try {
    const token = await obtenerAccessTokenVigente(empresaId, cuenta.cuentaId);
    const ruta = cuenta.rutaArchivo ?? rutaPorDefecto;
    const contentType = cuenta.contentType ?? contentTypePorDefecto;
    const resultado = await subirClipItemDesdeArchivo(token, cuenta.itemId, ruta, "clip.mp4", contentType);
    // status real documentado por Mercado Libre: "accepted" = recibido,
    // todavía sin moderar — se marca "en_moderacion" (nunca "publicado"
    // de entrada, eso lo confirma recién obtenerClipsMl más adelante).
    fila.estado = "en_moderacion";
    fila.clipUuid = resultado.clipUuid;
  } catch (error) {
    fila.estado = "error";
    fila.error = mensajeDeErrorSubida(error);
  }
}

// Arranca el trabajo real (sin esperarlo — ver el comentario de
// arriba) y devuelve el id de inmediato. El archivo temporal
// COMPARTIDO (cuando varias cuentas usan "el mismo video para todas")
// se borra UNA sola vez, al terminar TODAS las cuentas — nunca antes
// (una cuenta lenta todavía podría estar leyéndolo) y SIEMPRE al final,
// haya ido bien o mal cualquiera de las subidas.
export function iniciarTrabajoClip(
  empresaId: string,
  cuentas: CuentaParaSubirClip[],
  rutaArchivoPorDefecto: string,
  contentTypePorDefecto: string
): string {
  podarTrabajosViejos();
  const id = crypto.randomUUID();
  const trabajo: TrabajoClip = {
    id,
    empresaId,
    creadoTs: Date.now(),
    terminadoTs: null,
    cuentas: cuentas.map((c) => ({ cuentaId: c.cuentaId, nickname: c.nickname, itemId: c.itemId, estado: "en_cola", error: null, clipUuid: null })),
  };
  trabajos.set(id, trabajo);

  // Rutas de archivo ÚNICAS entre todas las cuentas de este trabajo
  // (el por defecto compartido + cualquier override puntual) — se
  // borran TODAS al final, nunca solo la compartida, para no dejar
  // ningún archivo "override" de una cuenta puntual huérfano en
  // os.tmpdir().
  const rutasABorrar = new Set<string>([rutaArchivoPorDefecto, ...cuentas.map((c) => c.rutaArchivo).filter((r): r is string => Boolean(r))]);

  void (async () => {
    try {
      await conConcurrenciaLimitada(cuentas, CONCURRENCIA_SUBIDA_CLIP, async (cuenta, indice) => {
        const fila = trabajo.cuentas[indice];
        try {
          await subirAUnaCuenta(empresaId, cuenta, rutaArchivoPorDefecto, contentTypePorDefecto, fila);
        } catch (error) {
          // conConcurrenciaLimitada NUNCA atrapa errores por su cuenta
          // (ver lib/concurrencia.ts) — subirAUnaCuenta ya atrapa todo
          // lo suyo, esto es solo una red de seguridad extra para que
          // un bug real acá nunca tire abajo el resto de las cuentas.
          fila.estado = "error";
          fila.error = mensajeDeErrorSubida(error);
        }
      });
    } finally {
      trabajo.terminadoTs = Date.now();
      await Promise.all([...rutasABorrar].map((ruta) => rm(ruta, { force: true }).catch(() => undefined)));
    }
  })();

  return id;
}

// RLS a mano para un Map en memoria (no hay Postgres acá) — nunca se
// devuelve un trabajo de otra empresa, aunque alguien adivine un id
// real ajeno.
export function obtenerTrabajoClip(jobId: string, empresaId: string): TrabajoClip | null {
  const trabajo = trabajos.get(jobId);
  if (!trabajo || trabajo.empresaId !== empresaId) return null;
  return trabajo;
}
