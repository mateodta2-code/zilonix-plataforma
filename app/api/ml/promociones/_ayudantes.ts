import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { listarEmpresasDeUsuario } from "@/lib/empresas";
import { obtenerOCrearUsuarioActual } from "@/lib/usuarios";
import { SinPermisoError } from "@/lib/permisos";

// Rama feat-promociones — helpers compartidos por las rutas de
// Promociones. No es una ruta en sí (nombre con "_" a propósito, mismo
// criterio que app/api/ml/clip/_ayudantes.ts) para que
// scripts/verificar-permisos.test.ts nunca la vea como algo que
// clasificar. Duplicado a propósito en vez de importarse de otro
// grupo de rutas — mismo criterio documentado en clip/_ayudantes.ts:
// un grupo de rutas nunca depende de los helpers privados de otro.
export const PATRON_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type SesionYEmpresa = { usuario: { id: string }; empresa: { id: string; nombre: string } };

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

export function respuestaSiOrigenInvalido(request: Request, origenEsperado: string): NextResponse | null {
  const origenRecibido = request.headers.get("origin") ?? origenDeReferer(request.headers.get("referer"));
  if (!origenRecibido || origenRecibido !== origenEsperado) {
    return NextResponse.json({ error: "Origen no autorizado." }, { status: 403 });
  }
  return null;
}
