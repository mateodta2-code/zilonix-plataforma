import { cookies } from "next/headers";
import { NextRequest, NextResponse } from "next/server";
import { listarEmpresasDeUsuario } from "@/lib/empresas";
import { obtenerOCrearUsuarioActual } from "@/lib/usuarios";
import { requierePermiso, SinPermisoError } from "@/lib/permisos";
import { listarCuentasConectadas, obtenerAccessTokenVigente } from "@/lib/ml/cuentas";
import { PATRON_ID_PRODUCTO_O_ITEM } from "@/lib/ml/cliente";
import {
  ClipDemasiadoGrandeError,
  ClipInvalidoError,
  ClipReputacionRequeridaError,
  ClipSinRespuestaError,
  subirClipItem,
  validarArchivoClip,
  TAMANO_MAXIMO_CLIP_BYTES,
} from "@/lib/ml/clip";
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

// cuentaId es un UUID real (columna `id` de cuentas_ml, Postgres
// `gen_random_uuid()`) — se valida el FORMATO antes de tocar la base,
// nunca solo "no vacío".
const PATRON_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function origenDeReferer(referer: string | null): string | null {
  if (!referer) return null;
  try {
    return new URL(referer).origin;
  } catch {
    return null;
  }
}

// Nunca texto libre a la URL del redirect — una lista cerrada de
// códigos, mapeados por `instanceof` desde las clases tipadas de
// lib/ml/clip.ts (nunca adivinando por el texto del mensaje). El orden
// importa: ClipDemasiadoGrandeError extends ClipInvalidoError, así que
// se revisa primero la subclase más específica.
function codigoDeErrorDeSubida(error: unknown): string {
  if (error instanceof ClipDemasiadoGrandeError) return "demasiado_grande";
  if (error instanceof ClipInvalidoError) return "archivo_invalido";
  if (error instanceof ClipReputacionRequeridaError) return "reputacion_requerida";
  if (error instanceof ClipSinRespuestaError) return "sin_respuesta_ml";
  if (error instanceof Error) return "rechazado_ml";
  return "error_desconocido";
}

export async function POST(request: NextRequest) {
  // Code review de Pablo — antes CLIP_HABILITADO solo ocultaba el
  // link en /panel/publicar/page.tsx; esta API seguía aceptando una
  // subida real por URL directa. 404 (nunca 403/503): para cualquiera
  // que no sea quien la desactivó, la ruta simplemente "no existe" —
  // mismo default seguro que la página (oculto si falta o es distinta
  // de "true"), antes de leer sesión/body/nada del cuerpo.
  if (process.env.CLIP_HABILITADO !== "true") {
    return NextResponse.json({ error: "No encontrado." }, { status: 404 });
  }

  const base = urlPublicaBase();
  const origenEsperado = new URL(base).origin;
  // Issue real: este endpoint acepta un <form> normal (nunca JSON, ni
  // un fetch con cabeceras propias) — exactamente el perfil de
  // petición que un CSRF clásico (un <form> en un sitio AJENO,
  // apuntando acá) también puede mandar. El origin real del navegador
  // (Origin, o el de Referer si el navegador no manda Origin en este
  // caso puntual) tiene que coincidir con el dominio real de la app —
  // comparado ANTES de cualquier otra cosa, incluso antes de mirar la
  // sesión, para no gastar ni una consulta en una petición que ya se
  // sabe que viene de otro origen. En dev (sin RAILWAY_PUBLIC_DOMAIN),
  // urlPublicaBase() ya resuelve el host local desde la propia
  // petición — ver lib/url-publica.ts.
  const origenRecibido = request.headers.get("origin") ?? origenDeReferer(request.headers.get("referer"));
  if (!origenRecibido || origenRecibido !== origenEsperado) {
    return NextResponse.json({ error: "Origen no autorizado." }, { status: 403 });
  }

  // Parte 2 (página única, estructura de Zilonix OS) — antes volvía a
  // /panel/publicar/clip (su propia pantalla); la sección de Clip
  // ahora vive AL FINAL de /panel/publicar — mismo query, con el
  // ancla de esa sección.
  const volver = (query: Record<string, string>) => {
    const params = new URLSearchParams(query);
    return NextResponse.redirect(`${base}/panel/publicar?${params.toString()}#clip`, 303);
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
    if (error instanceof SinPermisoError) return volver({ error: "sin_permiso" });
    throw error;
  }

  // Rechazo por tamaño ANTES de leer nada del cuerpo (nunca
  // request.formData() todavía) — un video que de entrada ya se sabe
  // que va a sobrar nunca se llega a cargar en memoria. Content-length
  // AUSENTE o no numérico se rechaza igual: sin ese dato no hay forma
  // de saber el tamaño antes de leer el body, y un formulario real
  // (multipart, sin streaming manual) siempre lo manda.
  const contentLengthCrudo = request.headers.get("content-length");
  const contentLength = Number(contentLengthCrudo);
  if (!contentLengthCrudo || !Number.isFinite(contentLength) || contentLength > TAMANO_MAXIMO_PETICION_BYTES) {
    return volver({ error: "demasiado_grande" });
  }

  const formData = await request.formData();
  const cuentaId = String(formData.get("cuentaId") ?? "");
  const itemId = String(formData.get("itemId") ?? "");
  const archivo = formData.get("archivo");
  if (!cuentaId || !itemId || !(archivo instanceof File) || archivo.size === 0) {
    return volver({ cuentaId, itemId, error: "faltan_datos" });
  }

  // Formato de cuentaId/itemId ANTES de obtenerAccessTokenVigente (y
  // antes de cualquier otra consulta): un id mal formado nunca llega a
  // tocar la base ni Mercado Libre — mismo criterio exacto que
  // exigirId() en lib/ml/cliente.ts, acá adelantado un paso.
  if (!PATRON_UUID.test(cuentaId)) return volver({ cuentaId, itemId, error: "cuenta_invalida" });
  if (!PATRON_ID_PRODUCTO_O_ITEM.test(itemId)) return volver({ cuentaId, itemId, error: "item_invalido" });

  // listarCuentasConectadas ya pasa por dbComoEmpresa (RLS): una
  // cuentaId real pero de OTRA empresa simplemente no aparece en esta
  // lista — cae en "cuenta_invalida" igual que si no existiera.
  const cuentas = await listarCuentasConectadas(empresa.id);
  const cuenta = cuentas.find((c) => c.id === cuentaId);
  if (!cuenta) return volver({ cuentaId, itemId, error: "cuenta_invalida" });
  if (cuenta.desconectadaTs) return volver({ cuentaId, itemId, error: "cuenta_desconectada" });

  try {
    validarArchivoClip(archivo.type, archivo.size);
    const token = await obtenerAccessTokenVigente(empresa.id, cuentaId);
    const buffer = await archivo.arrayBuffer();
    await subirClipItem(token, itemId, buffer, archivo.name, archivo.type);
  } catch (error) {
    const codigo = codigoDeErrorDeSubida(error);
    // El detalle real (puede llevar hasta 800 caracteres del cuerpo
    // que mandó Mercado Libre, ver lib/ml/clip.ts) solo va al log del
    // servidor, recortado — nunca a la URL del redirect, y nunca el
    // token (que ni siquiera llega hasta acá en texto plano).
    console.error(`[app/api/ml/clip] subida falló (${codigo}):`, error instanceof Error ? error.message.slice(0, 500) : String(error));
    return volver({ cuentaId, itemId, error: codigo });
  }

  return volver({ cuentaId, itemId, clipSubido: "1" });
}
