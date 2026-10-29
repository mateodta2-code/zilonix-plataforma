import { rm, stat } from "fs/promises";
import { NextResponse } from "next/server";
import { requierePermiso } from "@/lib/permisos";
import { listarCuentasConectadas } from "@/lib/ml/cuentas";
import { PATRON_ID_PRODUCTO_O_ITEM } from "@/lib/ml/cliente";
import { ClipDemasiadoGrandeError, ClipInvalidoError, TAMANO_MAXIMO_CLIP_BYTES, validarArchivoClip } from "@/lib/ml/clip";
import { iniciarTrabajoClip, type CuentaParaSubirClip } from "@/lib/trabajos/subirClipMultiCuenta";
import { obtenerVideoTemporal, quitarVideoTemporalDelMapa } from "@/lib/trabajos/videoTemporalClip";
import { recibirMultipartVideo, MultipartArchivoDemasiadoGrandeError, MultipartInvalidoError, type ArchivoRecibido } from "@/lib/ml/recibir-multipart-video";
import { urlPublicaBase } from "@/lib/url-publica";
import { PATRON_UUID, respuestaSiClipDeshabilitado, respuestaSiOrigenInvalido, respuestaSiSinPermiso, resolverSesionYEmpresa } from "./_ayudantes";

// Runtime Node explícito — esta ruta parsea un multipart de hasta
// 280MB POR ARCHIVO con busboy (lib/ml/recibir-multipart-video.ts),
// necesita el runtime completo de Node, no el Edge.
export const runtime = "nodejs";

// Rama feat-publicar-clip, punto 4 — reemplaza por completo la versión
// anterior de esta ruta (subía UNA cuenta, cargaba el video entero en
// memoria con request.formData(), y volvía con un redirect `?error=`).
// Ahora: streaming a disco de verdad (nunca en memoria), MUCHAS cuentas
// a la vez vía lib/trabajos/subirClipMultiCuenta.ts, y responde
// {jobId} de inmediato — la UI consulta el progreso en
// /api/ml/clip/trabajo/[jobId] (polling), nunca espera acá a que las
// subidas reales terminen.
//
// Origen del video (punto 1 del pedido) — esta ruta acepta DOS formas
// de recibir el video por defecto (exactamente una de las dos):
// - `archivo` (multipart, streaming a disco con busboy): "desde el
//   computador".
// - `tempVideoId` (campo de texto): el video ya está en disco porque
//   se bajó antes con /api/ml/clip/traer-video (origen "link", "por
//   SKU propio" o "desde la extensión" — las tres terminan en el mismo
//   archivo intermedio, ver lib/trabajos/videoTemporalClip.ts).
// Por cuenta, un override puntual ("usar otro video para esta cuenta")
// llega como `archivo_<cuentaId>` o `tempVideoId_<cuentaId>`.
const MARGEN_MULTIPART_BYTES = 2 * 1024 * 1024;
// Generoso a propósito: cubre el video por defecto + overrides
// puntuales de varias cuentas en la misma petición. El tope REAL de
// seguridad es el de busboy (fileSize por parte, ver
// recibirMultipartVideo) — esto es solo un rechazo rápido antes de
// gastar tiempo parseando una petición que de entrada ya se sabe
// absurda.
const TAMANO_MAXIMO_PETICION_BYTES = TAMANO_MAXIMO_CLIP_BYTES * 6 + MARGEN_MULTIPART_BYTES;

type CuentaPedida = { cuentaId: string; itemId: string };

function codigoDeErrorDeVideo(error: unknown): string {
  if (error instanceof ClipDemasiadoGrandeError) return "demasiado_grande";
  if (error instanceof ClipInvalidoError) return "archivo_invalido";
  if (error instanceof MultipartArchivoDemasiadoGrandeError) return "demasiado_grande";
  if (error instanceof MultipartInvalidoError) return "formato_invalido";
  return "error_desconocido";
}

function parsearCuentasPedidas(crudo: string | undefined): CuentaPedida[] | null {
  if (!crudo) return null;
  let datos: unknown;
  try {
    datos = JSON.parse(crudo);
  } catch {
    return null;
  }
  if (!Array.isArray(datos) || datos.length === 0) return null;
  const cuentas: CuentaPedida[] = [];
  for (const fila of datos) {
    const cuentaId = (fila as { cuentaId?: unknown })?.cuentaId;
    const itemId = (fila as { itemId?: unknown })?.itemId;
    if (typeof cuentaId !== "string" || typeof itemId !== "string") return null;
    if (!PATRON_UUID.test(cuentaId) || !PATRON_ID_PRODUCTO_O_ITEM.test(itemId)) return null;
    cuentas.push({ cuentaId, itemId });
  }
  return cuentas;
}

async function validarArchivoEnDisco(rutaArchivo: string, contentType: string): Promise<void> {
  const info = await stat(rutaArchivo);
  validarArchivoClip(contentType, info.size);
}

export async function POST(request: Request) {
  const respuestaDeshabilitado = respuestaSiClipDeshabilitado();
  if (respuestaDeshabilitado) return respuestaDeshabilitado;

  const base = urlPublicaBase();
  const respuestaOrigen = respuestaSiOrigenInvalido(request, new URL(base).origin);
  if (respuestaOrigen) return respuestaOrigen;

  const sesion = await resolverSesionYEmpresa();
  if (sesion instanceof NextResponse) return sesion;
  const { empresa } = sesion;

  try {
    await requierePermiso(sesion.usuario.id, empresa.id, "inventario", "modificar");
  } catch (error) {
    const respuestaPermiso = respuestaSiSinPermiso(error);
    if (respuestaPermiso) return respuestaPermiso;
    throw error;
  }

  // Rechazo rápido por tamaño ANTES de parsear nada del cuerpo (ver el
  // comentario del tope arriba).
  const contentLengthCrudo = request.headers.get("content-length");
  const contentLength = Number(contentLengthCrudo);
  if (!contentLengthCrudo || !Number.isFinite(contentLength) || contentLength > TAMANO_MAXIMO_PETICION_BYTES) {
    return NextResponse.json({ error: "demasiado_grande" }, { status: 400 });
  }

  let campos: Record<string, string>;
  let archivos: Record<string, ArchivoRecibido>;
  try {
    ({ campos, archivos } = await recibirMultipartVideo(request, TAMANO_MAXIMO_CLIP_BYTES + MARGEN_MULTIPART_BYTES));
  } catch (error) {
    console.error("[app/api/ml/clip] falló el parseo del multipart:", error instanceof Error ? error.message.slice(0, 500) : String(error));
    return NextResponse.json({ error: codigoDeErrorDeVideo(error) }, { status: 400 });
  }

  // Cualquier archivo que busboy haya escrito a disco y que esta
  // función NO termine "reclamando" para el trabajo (una validación
  // falló, una cuenta no es válida, el pedido entero se rechaza) se
  // borra SIEMPRE al salir — nunca queda un .tmp huérfano en
  // os.tmpdir() por un pedido que no llegó a arrancar el trabajo. Cada
  // ruta se saca del Set en el momento exacto en que queda en manos de
  // iniciarTrabajoClip (que es quien la borra de verdad, al terminar).
  const rutasBusboySinReclamar = new Set(Object.values(archivos).map((a) => a.rutaArchivo));

  try {
    const cuentasPedidas = parsearCuentasPedidas(campos.cuentas);
    if (!cuentasPedidas) return NextResponse.json({ error: "faltan_datos" }, { status: 400 });

    // Origen por defecto: exactamente uno de los dos (archivo subido o
    // video ya bajado antes con /api/ml/clip/traer-video).
    const archivoPorDefecto = archivos.archivo;
    const tempVideoIdPorDefecto = campos.tempVideoId;
    if ((archivoPorDefecto && tempVideoIdPorDefecto) || (!archivoPorDefecto && !tempVideoIdPorDefecto)) {
      return NextResponse.json({ error: "faltan_datos" }, { status: 400 });
    }

    let rutaPorDefecto: string;
    let contentTypePorDefecto: string;
    // Id a sacar del mapa de videos temporales — SOLO después de
    // validar con éxito (ver más abajo). Bug evitado: sacarlo del mapa
    // antes de validar y después rechazar por archivo inválido dejaba
    // ese archivo sin dueño (ya no está en el mapa para que la poda lo
    // borre, y no es de busboy para que rutasBusboySinReclamar lo
    // borre) — un .tmp huérfano para siempre.
    let tempVideoIdPorDefectoAUsar: string | null = null;
    if (archivoPorDefecto) {
      rutaPorDefecto = archivoPorDefecto.rutaArchivo;
      contentTypePorDefecto = archivoPorDefecto.contentType;
    } else {
      const video = obtenerVideoTemporal(tempVideoIdPorDefecto, empresa.id);
      if (!video) return NextResponse.json({ error: "video_no_encontrado" }, { status: 400 });
      rutaPorDefecto = video.rutaArchivo;
      contentTypePorDefecto = video.contentType;
      tempVideoIdPorDefectoAUsar = tempVideoIdPorDefecto;
    }

    try {
      await validarArchivoEnDisco(rutaPorDefecto, contentTypePorDefecto);
    } catch (error) {
      // Si venía del mapa de videos temporales, queda ahí tal cual —
      // la poda de videoTemporalClip.ts lo termina borrando sola.
      return NextResponse.json({ error: codigoDeErrorDeVideo(error) }, { status: 400 });
    }

    // listarCuentasConectadas ya pasa por dbComoEmpresa (RLS) — una
    // cuentaId real pero de otra empresa, o ya desconectada, simplemente
    // se excluye acá (nunca rompe el resto del pedido).
    const cuentasConectadas = await listarCuentasConectadas(empresa.id);
    const cuentasFinal: CuentaParaSubirClip[] = [];
    // El video por defecto todavía NO se "reclama" (no se saca ni de
    // rutasBusboySinReclamar ni del mapa de videos temporales) hasta
    // saber que va a existir un trabajo de verdad — bug evitado: si se
    // reclamaba antes y después no quedaba NINGUNA cuenta válida (ver
    // el chequeo de cuentasFinal.length más abajo), el archivo quedaba
    // sin dueño que lo borrara nunca.
    const idsASacarDelMapaTemporal: string[] = tempVideoIdPorDefectoAUsar ? [tempVideoIdPorDefectoAUsar] : [];
    const rutasAQuitarDeBusboySinReclamar: string[] = [rutaPorDefecto];

    for (const pedida of cuentasPedidas) {
      const cuenta = cuentasConectadas.find((c) => c.id === pedida.cuentaId && !c.desconectadaTs);
      if (!cuenta) continue;

      const archivoOverride = archivos[`archivo_${pedida.cuentaId}`];
      const tempVideoIdOverride = campos[`tempVideoId_${pedida.cuentaId}`];
      let rutaOverride: string | undefined;
      let contentTypeOverride: string | undefined;
      let tempVideoIdOverrideAUsar: string | null = null;
      if (archivoOverride) {
        rutaOverride = archivoOverride.rutaArchivo;
        contentTypeOverride = archivoOverride.contentType;
      } else if (tempVideoIdOverride) {
        const video = obtenerVideoTemporal(tempVideoIdOverride, empresa.id);
        // Un override puntual inválido/vencido NUNCA tira abajo toda la
        // subida: esta cuenta sigue en la lista con el video por
        // defecto, nunca sin avisar — queda documentado en el reporte a
        // Mateo, es una decisión de alcance, no un bug.
        if (video) {
          rutaOverride = video.rutaArchivo;
          contentTypeOverride = video.contentType;
          tempVideoIdOverrideAUsar = tempVideoIdOverride;
        }
      }

      if (rutaOverride && contentTypeOverride) {
        try {
          await validarArchivoEnDisco(rutaOverride, contentTypeOverride);
          rutasAQuitarDeBusboySinReclamar.push(rutaOverride);
          if (tempVideoIdOverrideAUsar) idsASacarDelMapaTemporal.push(tempVideoIdOverrideAUsar);
        } catch {
          // El video propio de esta cuenta puntual es inválido — se
          // ignora el override (nunca el resto del pedido) y esta
          // cuenta sigue con el video por defecto. Nunca se reclamó
          // (no está en ninguna de las dos listas de arriba), así que
          // sigue limpiándose solo por su camino normal (busboy al
          // salir, o la poda de videoTemporalClip.ts).
          rutaOverride = undefined;
          contentTypeOverride = undefined;
        }
      }

      cuentasFinal.push({ cuentaId: cuenta.id, nickname: cuenta.nickname, itemId: pedida.itemId, rutaArchivo: rutaOverride, contentType: contentTypeOverride });
    }

    if (cuentasFinal.length === 0) return NextResponse.json({ error: "cuenta_invalida" }, { status: 400 });

    // Recién ACÁ hay un trabajo de verdad — todos los archivos
    // involucrados pasan a ser responsabilidad exclusiva de
    // iniciarTrabajoClip (los borra al terminar).
    for (const ruta of rutasAQuitarDeBusboySinReclamar) rutasBusboySinReclamar.delete(ruta);
    for (const id of idsASacarDelMapaTemporal) quitarVideoTemporalDelMapa(id, empresa.id);

    const jobId = iniciarTrabajoClip(empresa.id, cuentasFinal, rutaPorDefecto, contentTypePorDefecto);
    return NextResponse.json({ jobId });
  } finally {
    await Promise.all([...rutasBusboySinReclamar].map((ruta) => rm(ruta, { force: true }).catch(() => undefined)));
  }
}
