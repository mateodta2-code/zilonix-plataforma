import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { listarEmpresasDeUsuario } from "@/lib/empresas";
import { obtenerOCrearUsuarioActual } from "@/lib/usuarios";
import { SinPermisoError } from "@/lib/permisos";

// Rama feat-publicar-clip — helpers compartidos por las rutas nuevas
// de Clip (subir, buscar-sku, trabajo/[jobId], estado, traer-video,
// video-temp/[id]). No es una ruta en sí (nombre con "_" a propósito,
// mismo criterio que app/api/ml/publicar/_ayudantes.ts) para que
// scripts/verificar-permisos.test.ts nunca la vea como algo que
// clasificar. PATRON_UUID/respuestaSiSinPermiso se DUPLICAN a propósito
// en vez de importarse de publicar/_ayudantes.ts — mismo criterio
// documentado ahí: un grupo de rutas nunca depende de los helpers
// privados de otro grupo.
export const PATRON_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Code review de Pablo (heredado de app/api/ml/clip/route.ts) — antes
// CLIP_HABILITADO solo ocultaba el link en la página; cualquier ruta
// nueva de este sub-flujo tiene que repetir el mismo candado 404 (nunca
// 403/503) ANTES de leer sesión o cuerpo, para que alguien sin la
// bandera encendida vea exactamente lo mismo que si la ruta no
// existiera.
export function respuestaSiClipDeshabilitado(): NextResponse | null {
  if (process.env.CLIP_HABILITADO !== "true") return NextResponse.json({ error: "No encontrado." }, { status: 404 });
  return null;
}

export type SesionYEmpresa = { usuario: { id: string }; empresa: { id: string; nombre: string } };

// Mismo patrón de siempre (sesión real + empresa activa de la cookie,
// o la primera propia si no hay cookie) — unificado acá porque las 6
// rutas nuevas de este sub-flujo lo repiten idéntico.
export async function resolverSesionYEmpresa(): Promise<SesionYEmpresa | NextResponse> {
  const usuario = await obtenerOCrearUsuarioActual();
  if (!usuario) return NextResponse.json({ error: "Sin sesión." }, { status: 401 });

  const propias = await listarEmpresasDeUsuario(usuario.id);
  const empresaId = cookies().get("empresa_actual")?.value;
  const empresa = propias.find((e) => e.id === empresaId) ?? propias[0];
  if (!empresa) return NextResponse.json({ error: "Sin empresa activa." }, { status: 400 });

  return { usuario, empresa };
}

export function respuestaSiSinPermiso(error: unknown): NextResponse | null {
  if (error instanceof SinPermisoError) return NextResponse.json({ error: "No tenés permiso para esto." }, { status: 403 });
  return null;
}

function origenDeReferer(referer: string | null): string | null {
  if (!referer) return null;
  try {
    return new URL(referer).origin;
  } catch {
    return null;
  }
}

// CSRF — mismo criterio que la versión anterior de app/api/ml/clip/
// route.ts: estas rutas se llaman desde `fetch` del propio navegador
// con sesión de Clerk (cookie), nunca desde otro origen. Se exige ANTES
// de tocar sesión/base.
export function respuestaSiOrigenInvalido(request: Request, origenEsperado: string): NextResponse | null {
  const origenRecibido = request.headers.get("origin") ?? origenDeReferer(request.headers.get("referer"));
  if (!origenRecibido || origenRecibido !== origenEsperado) {
    return NextResponse.json({ error: "Origen no autorizado." }, { status: 403 });
  }
  return null;
}
