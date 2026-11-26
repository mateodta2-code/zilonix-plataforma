import { cookies } from "next/headers";
import { NextRequest, NextResponse } from "next/server";
import { listarEmpresasDeUsuario } from "@/lib/empresas";
import { responderImagenPrivada } from "@/lib/imagenes/responderPrivada";
import { imagenDeMiTicket, requiereMiembroActivo, SoporteError } from "@/lib/soporte/tickets";
import { obtenerOCrearUsuarioActual } from "@/lib/usuarios";

// Capturas de tickets (25-nov) para el VENDEDOR. Mismo permiso que los
// tickets: cualquier miembro de la empresa activa. La captura solo sale si
// está en ese ticket y el ticket es de su empresa (RLS en imagenDeMiTicket).
export async function GET(_request: NextRequest, { params }: { params: { ticketId: string; archivo: string } }) {
  const usuario = await obtenerOCrearUsuarioActual();
  if (!usuario) return NextResponse.json({ error: "Sin sesión." }, { status: 401 });
  const propias = await listarEmpresasDeUsuario(usuario.id);
  const empresaId = cookies().get("empresa_actual")?.value;
  const empresa = propias.find((e) => e.id === empresaId) ?? propias[0];
  if (!empresa) return NextResponse.json({ error: "Sin empresa activa." }, { status: 400 });
  try {
    await requiereMiembroActivo(usuario.id, empresa.id);
  } catch (error) {
    if (error instanceof SoporteError) return NextResponse.json({ error: "Sin permiso." }, { status: 403 });
    throw error;
  }
  const publicId = await imagenDeMiTicket(empresa.id, params.ticketId, params.archivo);
  if (!publicId) return NextResponse.json({ error: "No encontrado." }, { status: 404 });
  return responderImagenPrivada(publicId, "app/api/soporte/imagen");
}
