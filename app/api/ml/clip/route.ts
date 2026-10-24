import { cookies } from "next/headers";
import { NextRequest, NextResponse } from "next/server";
import { listarEmpresasDeUsuario } from "@/lib/empresas";
import { obtenerOCrearUsuarioActual } from "@/lib/usuarios";
import { requierePermiso, SinPermisoError } from "@/lib/permisos";
import { obtenerAccessTokenVigente } from "@/lib/ml/cuentas";
import { subirClipItem, validarArchivoClip, TAMANO_MAXIMO_CLIP_BYTES } from "@/lib/ml/clip";
import { urlPublicaBase } from "@/lib/url-publica";

// Runtime Node explícito: esta ruta lee un cuerpo multipart de hasta
// 280MB con request.formData() — necesita el runtime completo de
// Node.js, no el Edge (límites de memoria/tamaño de cuerpo distintos y
// mucho más chicos).
export const runtime = "nodejs";

// Bug real: subirClipAction (Server Action, app/panel/publicar/clip/
// actions.ts) pasaba por el límite GLOBAL de next.config.mjs
// (experimental.serverActions.bodySizeLimit: "6mb", pensado para el
// CSV de hasta 5MB de /panel/sku/importar) — cualquier Clip real
// (Mercado Libre permite hasta 280MB) se rechazaba ANTES de llegar a
// validarArchivoClip (lib/ml/clip.ts), con un error genérico de Next.
// Subir el límite global no es opción: afectaría TODA Server Action de
// la app, no solo esta. Un Route Handler no tiene ese tope — la subida
// se mueve acá en vez de tocar next.config.mjs.
//
// Margen sobre el tamaño real máximo del video: content-length mide el
// CUERPO ENTERO de la petición multipart/form-data (boundary, headers
// de cada parte, los demás campos del formulario — cuentaId/itemId),
// no solo los bytes del video.
const MARGEN_MULTIPART_BYTES = 2 * 1024 * 1024;
const TAMANO_MAXIMO_PETICION_BYTES = TAMANO_MAXIMO_CLIP_BYTES + MARGEN_MULTIPART_BYTES;

export async function POST(request: NextRequest) {
  const base = urlPublicaBase();
  const volver = (query: Record<string, string>) => {
    const params = new URLSearchParams(query);
    return NextResponse.redirect(`${base}/panel/publicar/clip?${params.toString()}`, 303);
  };

  const usuario = await obtenerOCrearUsuarioActual();
  if (!usuario) return NextResponse.redirect(`${base}/sign-in`, 303);

  const propias = await listarEmpresasDeUsuario(usuario.id);
  const empresaId = cookies().get("empresa_actual")?.value;
  const empresa = propias.find((e) => e.id === empresaId) ?? propias[0];
  if (!empresa) return NextResponse.redirect(`${base}/crear-empresa`, 303);

  try {
    await requierePermiso(usuario.id, empresa.id, "inventario", "modificar");
  } catch (error) {
    if (error instanceof SinPermisoError) return volver({ error: error.message });
    throw error;
  }

  // Rechazo por content-length ANTES de leer nada del cuerpo (nunca
  // request.formData() todavía) — un video que de entrada ya se sabe
  // que va a sobrar nunca se llega a cargar en memoria.
  const contentLength = Number(request.headers.get("content-length") ?? "0");
  if (contentLength > TAMANO_MAXIMO_PETICION_BYTES) {
    return NextResponse.json(
      { error: "El video no puede superar 280MB — es el límite real de Mercado Libre para Clips." },
      { status: 413 }
    );
  }

  const formData = await request.formData();
  const cuentaId = String(formData.get("cuentaId") ?? "");
  const itemId = String(formData.get("itemId") ?? "");
  const archivo = formData.get("archivo");
  if (!cuentaId || !itemId || !(archivo instanceof File) || archivo.size === 0) {
    return volver({ cuentaId, itemId, error: "Faltan datos para subir el Clip." });
  }

  try {
    validarArchivoClip(archivo.type, archivo.size);
    const token = await obtenerAccessTokenVigente(empresa.id, cuentaId);
    const buffer = await archivo.arrayBuffer();
    await subirClipItem(token, itemId, buffer, archivo.name, archivo.type);
  } catch (error) {
    // Mensaje legible, nunca el token ni el texto crudo completo: los
    // errores de subirClipItem ya lo recortan (800 caracteres, lib/ml/
    // clip.ts) y nunca incluyen el token — acá se recorta otra vez, más
    // corto, porque esto viaja en la URL del redirect, no en un log.
    const mensaje = error instanceof Error ? error.message : "No se pudo subir el Clip.";
    return volver({ cuentaId, itemId, error: mensaje.slice(0, 300) });
  }

  return volver({ cuentaId, itemId, clipSubido: "1" });
}
