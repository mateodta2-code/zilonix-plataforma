import { cookies } from "next/headers";
import { NextRequest, NextResponse } from "next/server";
import { listarEmpresasDeUsuario } from "@/lib/empresas";
import { obtenerOCrearUsuarioActual } from "@/lib/usuarios";
import { requierePermiso } from "@/lib/permisos";
import { cloudinaryConfigurado, CloudinaryNoConfiguradoError, CloudinaryRechazoError, subirACloudinary } from "@/lib/cloudinary";
import {
  descargarImagenExternaSegura,
  tipoImagenPorMagicBytes,
  TAMANO_MAXIMO_FOTO_EXTERNA_BYTES,
  UrlExternaDemasiadoGrandeError,
  UrlExternaInvalidaError,
  UrlExternaNoDisponibleError,
  UrlExternaNoPermitidaError,
  UrlExternaTipoInvalidoError,
} from "@/app/panel/publicar/fotos/validar-url-externa";
import { respuestaSiSinPermiso } from "../_ayudantes";
import { urlPublicaBase } from "@/lib/url-publica";

// Parte 3, punto C — mismo motivo real que app/api/ml/clip/route.ts:
// una imagen de celular sin comprimir (hasta el tope de abajo) nunca
// entraría por una Server Action, que tiene el límite GLOBAL de
// next.config.mjs (experimental.serverActions.bodySizeLimit: "6mb",
// pensado para el CSV de SKU) — subir el límite global afectaría TODA
// Server Action de la app, no solo esta. Un Route Handler no tiene ese
// tope. A diferencia de Clip (un <form> normal, con redirect), esto lo
// llama GaleriaFotos.tsx con fetch() y necesita la URL de Cloudinary de
// vuelta para actualizar la galería en vivo, sin recargar la página —
// mismo criterio de "ruta que devuelve JSON" que las 3 rutas de
// categoría/características (app/api/ml/publicar/_ayudantes.ts).
export const runtime = "nodejs";

// Mismo tope que ya documenta validar-url-externa.ts para el link de
// Canva (8-10MB, foto de producto bien comprimida nunca necesita más)
// — una sola fuente de verdad del límite para los 2 caminos de entrada
// (archivo de la PC o URL externa), nunca dos números distintos.
const TAMANO_MAXIMO_FOTO_BYTES = TAMANO_MAXIMO_FOTO_EXTERNA_BYTES;
const TIPOS_IMAGEN_VALIDOS = new Set(["image/jpeg", "image/png", "image/webp"]);

function origenDeReferer(referer: string | null): string | null {
  if (!referer) return null;
  try {
    return new URL(referer).origin;
  } catch {
    return null;
  }
}

function codigoDeErrorDeUrlExterna(error: unknown): string {
  if (error instanceof UrlExternaInvalidaError) return "url_invalida";
  if (error instanceof UrlExternaNoPermitidaError) return "url_no_permitida";
  if (error instanceof UrlExternaDemasiadoGrandeError) return "demasiado_grande";
  if (error instanceof UrlExternaTipoInvalidoError) return "tipo_invalido";
  if (error instanceof UrlExternaNoDisponibleError) return "no_disponible";
  return "error_desconocido";
}

export async function POST(request: NextRequest) {
  // Mismo chequeo real que app/api/ml/clip/route.ts — esta ruta
  // acepta un <form> multipart (fetch con FormData desde
  // GaleriaFotos.tsx), el mismo perfil de petición que un CSRF
  // clásico también puede mandar. El origin real del navegador tiene
  // que coincidir con el dominio de la app, ANTES de mirar sesión o
  // cuerpo.
  const base = urlPublicaBase();
  const origenEsperado = new URL(base).origin;
  const origenRecibido = request.headers.get("origin") ?? origenDeReferer(request.headers.get("referer"));
  if (!origenRecibido || origenRecibido !== origenEsperado) {
    return NextResponse.json({ error: "Origen no autorizado." }, { status: 403 });
  }

  const usuario = await obtenerOCrearUsuarioActual();
  if (!usuario) return NextResponse.json({ error: "Sin sesión." }, { status: 401 });

  const propias = await listarEmpresasDeUsuario(usuario.id);
  const empresaId = cookies().get("empresa_actual")?.value;
  const empresa = propias.find((e) => e.id === empresaId) ?? propias[0];
  if (!empresa) return NextResponse.json({ error: "Sin empresa activa." }, { status: 400 });

  try {
    await requierePermiso(usuario.id, empresa.id, "inventario", "crear");
  } catch (error) {
    const respuestaPermiso = respuestaSiSinPermiso(error);
    if (respuestaPermiso) return respuestaPermiso;
    throw error;
  }

  if (!cloudinaryConfigurado()) {
    // Punto C del pedido — "si Cloudinary no está configurado: mensaje
    // claro, nunca romper el formulario; seguir permitiendo URL
    // manual." La URL manual (ya existente en GaleriaFotos.tsx) no
    // pasa por esta ruta — sigue funcionando igual, sin tocar nada.
    return NextResponse.json({ error: "Cloudinary no está configurado todavía en este ambiente." }, { status: 503 });
  }

  // Rechazo por tamaño ANTES de leer el cuerpo completo (mismo
  // criterio que app/api/ml/clip/route.ts) — un archivo que de entrada
  // ya se sabe que sobra nunca se llega a cargar en memoria. Margen
  // chico sobre el tope real: content-length mide el multipart ENTERO
  // (boundary, el campo canvaUrl si viniera junto), no solo los bytes
  // del archivo.
  const MARGEN_MULTIPART_BYTES = 256 * 1024;
  const contentLengthCrudo = request.headers.get("content-length");
  const contentLength = Number(contentLengthCrudo);
  if (contentLengthCrudo && Number.isFinite(contentLength) && contentLength > TAMANO_MAXIMO_FOTO_BYTES + MARGEN_MULTIPART_BYTES) {
    return NextResponse.json({ error: "La imagen supera el tamaño máximo permitido." }, { status: 413 });
  }

  const formData = await request.formData();
  const archivo = formData.get("archivo");
  const canvaUrl = String(formData.get("canvaUrl") ?? "").trim();

  try {
    if (archivo instanceof File && archivo.size > 0) {
      if (!TIPOS_IMAGEN_VALIDOS.has(archivo.type)) {
        return NextResponse.json({ error: "El archivo tiene que ser JPEG, PNG o WEBP." }, { status: 400 });
      }
      if (archivo.size > TAMANO_MAXIMO_FOTO_BYTES) {
        return NextResponse.json({ error: "La imagen supera el tamaño máximo permitido." }, { status: 413 });
      }
      const buffer = Buffer.from(await archivo.arrayBuffer());
      // Revisión de seguridad (hallazgo MED) — archivo.type lo pone el
      // NAVEGADOR de quien sube el archivo (a partir de la extensión o
      // de lo que declare el <input type="file">), nunca algo que este
      // servidor pueda confiar ciegamente: un .txt renombrado a .jpg
      // (o un archivo armado a mano) puede declararse "image/jpeg" sin
      // serlo. Se confirma contra la firma binaria real antes de
      // subirlo a Cloudinary — nunca solo por el MIME declarado.
      const tipoReal = tipoImagenPorMagicBytes(buffer);
      if (!tipoReal) {
        return NextResponse.json({ error: "El archivo no tiene una firma real de JPEG, PNG ni WEBP." }, { status: 400 });
      }
      const { url } = await subirACloudinary(buffer, archivo.name, tipoReal);
      return NextResponse.json({ url });
    }

    if (canvaUrl) {
      // descargarImagenExternaSegura ya valida https/allowlist/DNS
      // privada/tiempo/tamaño/Content-Type real — nunca se confía en
      // la extensión del link ni en que "parece" una imagen.
      const { buffer, contentType } = await descargarImagenExternaSegura(canvaUrl);
      const { url } = await subirACloudinary(buffer, "canva.jpg", contentType);
      return NextResponse.json({ url });
    }

    return NextResponse.json({ error: "Mandá un archivo o una URL de exportación de Canva." }, { status: 400 });
  } catch (error) {
    if (error instanceof CloudinaryNoConfiguradoError) {
      return NextResponse.json({ error: "Cloudinary no está configurado todavía en este ambiente." }, { status: 503 });
    }
    if (error instanceof CloudinaryRechazoError) {
      console.error("[app/api/ml/publicar/fotos] Cloudinary rechazó la subida:", error.message.slice(0, 500));
      return NextResponse.json({ error: "Cloudinary rechazó la imagen." }, { status: 502 });
    }
    if (
      error instanceof UrlExternaInvalidaError ||
      error instanceof UrlExternaNoPermitidaError ||
      error instanceof UrlExternaDemasiadoGrandeError ||
      error instanceof UrlExternaTipoInvalidoError ||
      error instanceof UrlExternaNoDisponibleError
    ) {
      return NextResponse.json({ error: error.message, codigo: codigoDeErrorDeUrlExterna(error) }, { status: 400 });
    }
    console.error("[app/api/ml/publicar/fotos] error inesperado:", error instanceof Error ? error.message.slice(0, 500) : String(error));
    return NextResponse.json({ error: "No se pudo subir la imagen." }, { status: 502 });
  }
}
