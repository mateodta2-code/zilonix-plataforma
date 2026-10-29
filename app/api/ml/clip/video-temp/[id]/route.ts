import { createReadStream } from "fs";
import { stat } from "fs/promises";
import { Readable } from "stream";
import { NextResponse } from "next/server";
import { requierePermiso } from "@/lib/permisos";
import { obtenerVideoTemporal } from "@/lib/trabajos/videoTemporalClip";
import { respuestaSiClipDeshabilitado, respuestaSiSinPermiso, resolverSesionYEmpresa } from "../../_ayudantes";

// Runtime Node explícito — streaming de un archivo real de disco con
// fs.createReadStream, no el Edge.
export const runtime = "nodejs";

// Rama feat-publicar-clip, punto 1/2 — le da al <video> del navegador
// algo que reproducir para el video que YA se bajó del lado del
// servidor (origen "link"/"por SKU propio"/"extensión", ver
// /api/ml/clip/traer-video). Soporta Range (Content-Range/206): varios
// navegadores (Safari en particular) necesitan Range real para
// siquiera empezar a leer metadatos de un <video>, no solo para
// "saltar" en la reproducción.
//
// Nunca lleva CSRF por Origin: GET de solo lectura, nunca cambia
// estado — mismo criterio que /api/ml/clip/trabajo/[jobId].
const PATRON_RANGE = /^bytes=(\d*)-(\d*)$/;

export async function GET(request: Request, { params }: { params: { id: string } }) {
  const respuestaDeshabilitado = respuestaSiClipDeshabilitado();
  if (respuestaDeshabilitado) return respuestaDeshabilitado;

  const sesion = await resolverSesionYEmpresa();
  if (sesion instanceof NextResponse) return sesion;
  const { usuario, empresa } = sesion;

  try {
    await requierePermiso(usuario.id, empresa.id, "inventario", "consultar");
  } catch (error) {
    const respuestaPermiso = respuestaSiSinPermiso(error);
    if (respuestaPermiso) return respuestaPermiso;
    throw error;
  }

  // RLS a mano (videoTemporalClip.ts) — un id real pero de otra
  // empresa vuelve null, exactamente igual que uno inexistente: nunca
  // se distingue "no existe" de "no es tuyo".
  const video = obtenerVideoTemporal(params.id, empresa.id);
  if (!video) return NextResponse.json({ error: "No se encontró ese video." }, { status: 404 });

  const info = await stat(video.rutaArchivo).catch(() => null);
  if (!info) return NextResponse.json({ error: "No se encontró ese video." }, { status: 404 });

  const rangoCrudo = request.headers.get("range");
  const coincidencia = rangoCrudo ? PATRON_RANGE.exec(rangoCrudo) : null;
  if (coincidencia) {
    const inicio = coincidencia[1] ? Number(coincidencia[1]) : 0;
    const fin = coincidencia[2] ? Number(coincidencia[2]) : info.size - 1;
    if (!Number.isFinite(inicio) || !Number.isFinite(fin) || inicio > fin || fin >= info.size) {
      return new NextResponse(null, { status: 416, headers: { "Content-Range": `bytes */${info.size}` } });
    }
    const stream = createReadStream(video.rutaArchivo, { start: inicio, end: fin });
    return new NextResponse(Readable.toWeb(stream) as unknown as ReadableStream, {
      status: 206,
      headers: {
        "Content-Type": video.contentType,
        "Content-Range": `bytes ${inicio}-${fin}/${info.size}`,
        "Content-Length": String(fin - inicio + 1),
        "Accept-Ranges": "bytes",
      },
    });
  }

  const stream = createReadStream(video.rutaArchivo);
  return new NextResponse(Readable.toWeb(stream) as unknown as ReadableStream, {
    status: 200,
    headers: { "Content-Type": video.contentType, "Content-Length": String(info.size), "Accept-Ranges": "bytes" },
  });
}
