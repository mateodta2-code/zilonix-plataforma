import { rm } from "fs/promises";
import { NextResponse } from "next/server";
import { requierePermiso } from "@/lib/permisos";
import {
  VideoExternoDemasiadoGrandeError,
  VideoExternoInvalidoError,
  VideoExternoNoDisponibleError,
  VideoExternoNoPermitidoError,
  VideoExternoTipoInvalidoError,
  descargarVideoExternoSeguro,
} from "@/lib/ml/video-externo";
import { registrarVideoTemporal } from "@/lib/trabajos/videoTemporalClip";
import { urlPublicaBase } from "@/lib/url-publica";
import { respuestaSiClipDeshabilitado, respuestaSiOrigenInvalido, respuestaSiSinPermiso, resolverSesionYEmpresa } from "../_ayudantes";

// Runtime Node explícito — descarga hasta 280MB por streaming a disco
// (lib/ml/video-externo.ts), igual que la subida.
export const runtime = "nodejs";

// Rama feat-publicar-clip, punto 1 ("Desde un link") — botón 'Traer':
// el servidor descarga el video una vez (anti-SSRF, allowlist de
// hosts, magic bytes — ver lib/ml/video-externo.ts) y lo deja en
// lib/trabajos/videoTemporalClip.ts para que el navegador lo
// previsualice (GET /api/ml/clip/video-temp/[id]) y, si el usuario
// confirma, la subida real (POST /api/ml/clip) lo use directo sin
// volver a descargarlo. Mismo origen para "por SKU propio" (cuando
// Mercado Libre da una URL descargable de un clip ya subido en otra
// cuenta) y "desde la extensión" (el receptor de postMessage valida el
// origen y llama a este mismo endpoint con la URL) — las tres
// terminan acá.
function codigoDeErrorDeDescarga(error: unknown): { codigo: string; status: number } {
  if (error instanceof VideoExternoInvalidoError) return { codigo: "link_invalido", status: 400 };
  if (error instanceof VideoExternoNoPermitidoError) return { codigo: "host_no_permitido", status: 400 };
  if (error instanceof VideoExternoNoDisponibleError) return { codigo: "no_disponible", status: 502 };
  if (error instanceof VideoExternoDemasiadoGrandeError) return { codigo: "demasiado_grande", status: 400 };
  if (error instanceof VideoExternoTipoInvalidoError) return { codigo: "tipo_invalido", status: 400 };
  return { codigo: "error_desconocido", status: 502 };
}

export async function POST(request: Request) {
  const respuestaDeshabilitado = respuestaSiClipDeshabilitado();
  if (respuestaDeshabilitado) return respuestaDeshabilitado;

  const base = urlPublicaBase();
  const respuestaOrigen = respuestaSiOrigenInvalido(request, new URL(base).origin);
  if (respuestaOrigen) return respuestaOrigen;

  const sesion = await resolverSesionYEmpresa();
  if (sesion instanceof NextResponse) return sesion;
  const { usuario, empresa } = sesion;

  try {
    await requierePermiso(usuario.id, empresa.id, "inventario", "modificar");
  } catch (error) {
    const respuestaPermiso = respuestaSiSinPermiso(error);
    if (respuestaPermiso) return respuestaPermiso;
    throw error;
  }

  let cuerpo: unknown;
  try {
    cuerpo = await request.json();
  } catch {
    return NextResponse.json({ error: "Falta el link." }, { status: 400 });
  }
  const url = typeof (cuerpo as { url?: unknown })?.url === "string" ? (cuerpo as { url: string }).url.trim() : "";
  if (!url) return NextResponse.json({ error: "Falta el link." }, { status: 400 });

  let descargado;
  try {
    descargado = await descargarVideoExternoSeguro(url);
  } catch (error) {
    const { codigo, status } = codigoDeErrorDeDescarga(error);
    console.error("[app/api/ml/clip/traer-video] falló la descarga:", error instanceof Error ? error.message.slice(0, 500) : String(error));
    return NextResponse.json({ error: codigo }, { status });
  }

  try {
    const video = registrarVideoTemporal(empresa.id, descargado.rutaArchivo, descargado.contentType, "video-traido.mp4");
    return NextResponse.json({
      tempVideoId: video.id,
      contentType: video.contentType,
      // Punto 2 del pedido ("Revisión antes de subir") — el navegador
      // ya sabe el tamaño real (lo midió Node al descargarlo); nunca
      // necesita volver a pedirlo ni adivinarlo desde el stream.
      byteLength: descargado.byteLength,
      streamUrl: `/api/ml/clip/video-temp/${video.id}`,
    });
  } catch (error) {
    // Si registrar en el mapa fallara por algo (nunca debería), el
    // archivo ya descargado no se queda huérfano.
    await rm(descargado.rutaArchivo, { force: true });
    throw error;
  }
}
