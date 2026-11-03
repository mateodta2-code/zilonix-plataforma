import { NextRequest, NextResponse } from "next/server";
import { requierePermiso } from "@/lib/permisos";
import { cloudinaryConfigurado, CloudinaryNoConfiguradoError, CloudinaryRechazoError } from "@/lib/cloudinary";
import {
  CandadoDeRenovacionCanvaError,
  ConexionCanvaDesconectadaError,
  ConexionCanvaNoEncontradaError,
  RenovacionTokenCanvaFallidaError,
  obtenerAccessTokenVigente,
} from "@/lib/canva/conexiones";
import {
  EnlaceCanvaInvalidoError,
  EnlaceCanvaNoDisponibleError,
  EnlaceCanvaNoPermitidoError,
  EnlaceCanvaSinDesignIdError,
  resolverDesignId,
} from "@/lib/canva/enlace";
import {
  ExportacionCanvaDemoradaError,
  ExportacionCanvaFallidaError,
  ExportacionCanvaSinAccesoError,
  ExportacionCanvaUrlNoPermitidaError,
  exportarDisenoPng,
  subirPaginasACloudinary,
} from "@/lib/canva/exportacion";
import { urlPublicaBase } from "@/lib/url-publica";
import { resolverSesionYEmpresa, respuestaSiOrigenInvalido, respuestaSiSinPermiso } from "../_ayudantes";

// Mismo runtime/motivo que app/api/ml/publicar/fotos/route.ts: puede
// tardar varios segundos (export + polling + varias subidas a
// Cloudinary), fuera del límite de una Server Action normal.
export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  const respuestaOrigen = respuestaSiOrigenInvalido(request, new URL(urlPublicaBase()).origin);
  if (respuestaOrigen) return respuestaOrigen;

  const sesion = await resolverSesionYEmpresa();
  if (sesion instanceof NextResponse) return sesion;
  const { usuario, empresa } = sesion;

  try {
    await requierePermiso(usuario.id, empresa.id, "inventario", "crear");
  } catch (error) {
    const respuestaPermiso = respuestaSiSinPermiso(error);
    if (respuestaPermiso) return respuestaPermiso;
    throw error;
  }

  if (!cloudinaryConfigurado()) {
    return NextResponse.json({ error: "Cloudinary no está configurado todavía en este ambiente." }, { status: 503 });
  }

  const body = (await request.json().catch(() => null)) as { link?: string } | null;
  const link = body?.link?.trim();
  if (!link) return NextResponse.json({ error: "Manda el link de Canva." }, { status: 400 });

  try {
    const designId = await resolverDesignId(link);
    const accessToken = await obtenerAccessTokenVigente(empresa.id, usuario.id);
    const urlsPng = await exportarDisenoPng(accessToken, designId);
    if (urlsPng.length === 0) {
      return NextResponse.json({ error: "Canva no devolvió ninguna página para ese diseño." }, { status: 502 });
    }
    const urls = await subirPaginasACloudinary(urlsPng);
    return NextResponse.json({ urls });
  } catch (error) {
    if (
      error instanceof ConexionCanvaNoEncontradaError ||
      error instanceof ConexionCanvaDesconectadaError ||
      error instanceof RenovacionTokenCanvaFallidaError
    ) {
      return NextResponse.json({ error: "Conecta tu Canva para traer el diseño.", codigo: "no_conectado" }, { status: 400 });
    }
    if (error instanceof CandadoDeRenovacionCanvaError) {
      return NextResponse.json({ error: error.message }, { status: 409 });
    }
    if (error instanceof ExportacionCanvaSinAccesoError) {
      return NextResponse.json({ error: error.message }, { status: 403 });
    }
    if (error instanceof ExportacionCanvaDemoradaError) {
      return NextResponse.json({ error: error.message }, { status: 504 });
    }
    if (error instanceof ExportacionCanvaFallidaError) {
      return NextResponse.json({ error: "Canva no pudo exportar ese diseño." }, { status: 502 });
    }
    if (error instanceof ExportacionCanvaUrlNoPermitidaError) {
      console.error("[api/canva/exportar-diseno] Canva devolvió una URL de exportación fuera de la allowlist:", error.message.slice(0, 300));
      return NextResponse.json({ error: "Canva devolvió una página fuera de lo permitido." }, { status: 502 });
    }
    if (
      error instanceof EnlaceCanvaInvalidoError ||
      error instanceof EnlaceCanvaNoPermitidoError ||
      error instanceof EnlaceCanvaNoDisponibleError ||
      error instanceof EnlaceCanvaSinDesignIdError
    ) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    if (error instanceof CloudinaryNoConfiguradoError) {
      return NextResponse.json({ error: error.message }, { status: 503 });
    }
    if (error instanceof CloudinaryRechazoError) {
      console.error("[api/canva/exportar-diseno] Cloudinary rechazó la subida:", error.message.slice(0, 500));
      return NextResponse.json({ error: "Cloudinary rechazó una de las páginas." }, { status: 502 });
    }
    console.error("[api/canva/exportar-diseno] error inesperado:", error instanceof Error ? error.message.slice(0, 500) : String(error));
    return NextResponse.json({ error: "No se pudo traer el diseño de Canva." }, { status: 502 });
  }
}
