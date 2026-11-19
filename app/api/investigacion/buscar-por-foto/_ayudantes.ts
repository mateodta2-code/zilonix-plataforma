import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { listarEmpresasDeUsuario } from "@/lib/empresas";
import { obtenerOCrearUsuarioActual } from "@/lib/usuarios";
import { SinPermisoError } from "@/lib/permisos";
import { urlPublicaBase } from "@/lib/url-publica";
import { detectarTipoImagen, MAX_BYTES_FOTO } from "@/lib/ml/buscarPorFoto";
import type { ImagenIA } from "@/lib/ia/proveedores";

// Helpers propios de este grupo de rutas (nombre con "_" a propósito,
// para que scripts/verificar-permisos.test.ts no lo vea como una ruta).
// Mismo patrón que app/api/configuracion/_ayudantes.ts, copiado y no
// importado: un grupo de rutas nunca depende de helpers privados de otro.

// Margen sobre MAX_BYTES_FOTO para el resto del multipart (campos de texto).
const MARGEN_MULTIPART = 256 * 1024;

function origenDeReferer(referer: string | null): string | null {
  if (!referer) return null;
  try {
    return new URL(referer).origin;
  } catch {
    return null;
  }
}

// Es un POST con cookie de sesión: sin esto otro sitio podría mandar
// fotos a la IA de la empresa (CSRF), gastando su cuenta.
function respuestaSiOrigenInvalido(request: Request): NextResponse | null {
  const esperado = new URL(urlPublicaBase()).origin;
  const recibido = request.headers.get("origin") ?? origenDeReferer(request.headers.get("referer"));
  if (!recibido || recibido !== esperado) return NextResponse.json({ error: "Origen no autorizado." }, { status: 403 });
  return null;
}

// Origen → sesión → empresa activa (cookie, igual que page.tsx).
// El permiso (requierePermiso "inventario"/"consultar") lo llama cada
// ruta en su propio archivo — scripts/verificar-permisos.test.ts exige
// verlo ahí. Sin pasar por los dos, nunca se lee la imagen ni se llama a la IA.
export async function resolverSesionYEmpresa(request: Request): Promise<{ usuarioId: string; empresaId: string } | NextResponse> {
  const respuestaOrigen = respuestaSiOrigenInvalido(request);
  if (respuestaOrigen) return respuestaOrigen;

  const usuario = await obtenerOCrearUsuarioActual();
  if (!usuario) return NextResponse.json({ error: "Sin sesión." }, { status: 401 });

  const propias = await listarEmpresasDeUsuario(usuario.id);
  const empresaId = cookies().get("empresa_actual")?.value;
  const empresa = propias.find((e) => e.id === empresaId) ?? propias[0];
  if (!empresa) return NextResponse.json({ error: "Sin empresa activa." }, { status: 400 });
  return { usuarioId: usuario.id, empresaId: empresa.id };
}

export function respuestaSiSinPermiso(error: unknown): NextResponse | null {
  if (error instanceof SinPermisoError) return NextResponse.json({ error: "No tienes permiso para esto." }, { status: 403 });
  return null;
}

// Corta ANTES de leer el cuerpo si el Content-Length declarado ya es enorme.
export function respuestaSiMuyGrande(request: Request, extraBytes = 0): NextResponse | null {
  const largo = Number(request.headers.get("content-length"));
  if (Number.isFinite(largo) && largo > MAX_BYTES_FOTO + MARGEN_MULTIPART + extraBytes) {
    return NextResponse.json({ error: "La foto pesa más de 5 MB." }, { status: 413 });
  }
  return null;
}

// Lee la imagen del multipart SOLO en memoria. El tipo sale de la firma
// de bytes, nunca del Content-Type ni de la extensión.
export async function leerImagen(form: FormData): Promise<{ imagen: ImagenIA } | NextResponse> {
  const archivo = form.get("imagen");
  if (!(archivo instanceof File)) return NextResponse.json({ error: "Falta la imagen." }, { status: 400 });
  if (archivo.size > MAX_BYTES_FOTO) return NextResponse.json({ error: "La foto pesa más de 5 MB." }, { status: 413 });
  const bytes = new Uint8Array(await archivo.arrayBuffer());
  const mediaType = detectarTipoImagen(bytes);
  if (!mediaType) return NextResponse.json({ error: "Solo se aceptan fotos JPG, PNG o WebP." }, { status: 415 });
  return { imagen: { mediaType, base64: Buffer.from(bytes).toString("base64") } };
}
