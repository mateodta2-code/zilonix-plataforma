import { NextRequest, NextResponse } from "next/server";
import { obtenerOCrearUsuarioActual } from "@/lib/usuarios";
import { cloudinaryConfigurado, CloudinaryNoConfiguradoError, CloudinaryRechazoError, subirACloudinary } from "@/lib/cloudinary";
import { tipoImagenPorMagicBytes, TAMANO_MAXIMO_FOTO_EXTERNA_BYTES } from "@/app/panel/publicar/fotos/validar-url-externa";
import { ForoError, frenarSubidasDeImagen, requiereMiembroDeAlgunaEmpresa } from "@/lib/foro";
import { CARPETA_IMAGENES_FORO } from "@/lib/foro-validacion";
import { urlPublicaBase } from "@/lib/url-publica";

// Foro (14-nov) — "Adjuntar imagen" en preguntas y respuestas. Route
// Handler y no Server Action por lo mismo que
// app/api/ml/publicar/fotos/route.ts: una foto de celular supera el
// límite global de 6mb de las Server Actions. Mismas defensas que esa
// ruta (origen, tamaño antes de leer, firma binaria real); devuelve la
// URL de Cloudinary, que el formulario manda al publicar y
// lib/foro.ts vuelve a validar (esUrlImagenForo).
export const runtime = "nodejs";

const TAMANO_MAXIMO_BYTES = TAMANO_MAXIMO_FOTO_EXTERNA_BYTES;
const MARGEN_MULTIPART_BYTES = 256 * 1024;

function origenDeReferer(referer: string | null): string | null {
  if (!referer) return null;
  try {
    return new URL(referer).origin;
  } catch {
    return null;
  }
}

export async function POST(request: NextRequest) {
  const origenEsperado = new URL(urlPublicaBase()).origin;
  const origenRecibido = request.headers.get("origin") ?? origenDeReferer(request.headers.get("referer"));
  if (!origenRecibido || origenRecibido !== origenEsperado) {
    return NextResponse.json({ error: "Origen no autorizado." }, { status: 403 });
  }

  const usuario = await obtenerOCrearUsuarioActual();
  if (!usuario) return NextResponse.json({ error: "Sin sesión." }, { status: 401 });

  try {
    await requiereMiembroDeAlgunaEmpresa(usuario.id);
    frenarSubidasDeImagen(usuario.id);
  } catch (error) {
    if (error instanceof ForoError) return NextResponse.json({ error: error.message }, { status: 429 });
    throw error;
  }

  if (!cloudinaryConfigurado()) {
    return NextResponse.json({ error: "Las imágenes no están disponibles todavía en este ambiente." }, { status: 503 });
  }

  const contentLength = Number(request.headers.get("content-length"));
  if (Number.isFinite(contentLength) && contentLength > TAMANO_MAXIMO_BYTES + MARGEN_MULTIPART_BYTES) {
    return NextResponse.json({ error: "La imagen pesa demasiado (máximo 8 MB)." }, { status: 413 });
  }

  let archivo: FormDataEntryValue | null;
  try {
    archivo = (await request.formData()).get("archivo");
  } catch {
    return NextResponse.json({ error: "No llegó ninguna imagen." }, { status: 400 });
  }
  if (!(archivo instanceof File) || archivo.size === 0) {
    return NextResponse.json({ error: "No llegó ninguna imagen." }, { status: 400 });
  }
  if (archivo.size > TAMANO_MAXIMO_BYTES) {
    return NextResponse.json({ error: "La imagen pesa demasiado (máximo 8 MB)." }, { status: 413 });
  }

  const buffer = Buffer.from(await archivo.arrayBuffer());
  // El tipo que declara el navegador no se cree: se confirma contra la
  // firma binaria real (mismo criterio que Publicar).
  const tipoReal = tipoImagenPorMagicBytes(buffer);
  if (!tipoReal) {
    return NextResponse.json({ error: "El archivo tiene que ser una imagen JPG, PNG o WEBP." }, { status: 400 });
  }

  try {
    const { url } = await subirACloudinary(buffer, "foro", tipoReal, CARPETA_IMAGENES_FORO);
    return NextResponse.json({ url });
  } catch (error) {
    if (error instanceof CloudinaryNoConfiguradoError) {
      return NextResponse.json({ error: "Las imágenes no están disponibles todavía en este ambiente." }, { status: 503 });
    }
    if (error instanceof CloudinaryRechazoError) {
      console.error("[app/api/foro/imagen] Cloudinary rechazó la subida:", error.message.slice(0, 500));
    } else {
      console.error("[app/api/foro/imagen] error inesperado:", error instanceof Error ? error.message.slice(0, 500) : String(error));
    }
    return NextResponse.json({ error: "No se pudo subir la imagen. Vuelve a intentar." }, { status: 502 });
  }
}
