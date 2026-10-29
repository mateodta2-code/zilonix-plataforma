import { NextResponse } from "next/server";
import { requierePermiso } from "@/lib/permisos";
import { obtenerTrabajoClip } from "@/lib/trabajos/subirClipMultiCuenta";
import { respuestaSiClipDeshabilitado, respuestaSiSinPermiso, resolverSesionYEmpresa } from "../../_ayudantes";

// Rama feat-publicar-clip, punto 4 — polling del progreso del trabajo
// de subida multi-cuenta (iniciarTrabajoClip, lib/trabajos/
// subirClipMultiCuenta.ts, ya tiene sus propios tests de la
// orquestación real). Este GET es solo el envoltorio HTTP + RLS a
// mano: obtenerTrabajoClip ya devuelve null si el trabajo es de otra
// empresa — acá eso se traduce a 404 (nunca 403, para no confirmarle a
// nadie que un jobId ajeno "existe pero no es suyo").
//
// Nunca lleva CSRF por Origin: es un GET de solo lectura (nunca cambia
// estado), igual que cualquier otro polling del repo — mismo criterio
// que respuestaSiOrigenInvalido documenta para las rutas que SÍ
// escriben.
export async function GET(_request: Request, { params }: { params: { jobId: string } }) {
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

  const trabajo = obtenerTrabajoClip(params.jobId, empresa.id);
  if (!trabajo) return NextResponse.json({ error: "No se encontró ese trabajo." }, { status: 404 });

  return NextResponse.json({ trabajo });
}
