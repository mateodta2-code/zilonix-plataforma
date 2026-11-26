import { NextRequest, NextResponse } from "next/server";
import { responderImagenPrivada } from "@/lib/imagenes/responderPrivada";
import { requiereSesionSuperadmin } from "@/lib/superadmin";
import { imagenDeTicketSuperadmin } from "@/lib/soporte/superadmin";

// Capturas de tickets (25-nov) para el SUPERADMIN que atiende el ticket. Lo
// que el vendedor adjuntó a propósito, como el texto del ticket (D8). Exige
// la sesión propia del superadmin (cookie firmada); sin ella, al login aparte.
// Vive bajo /superadmin y NO bajo /api: la cookie zx_superadmin tiene
// Path=/superadmin (lib/superadmin-sesion.ts) y el navegador no la manda a
// /api/... — ahí la ruta veía «sin sesión» y mandaba al login (bug real del
// primer despliegue).
export async function GET(_request: NextRequest, { params }: { params: { ticketId: string; archivo: string } }) {
  const { usuarioId } = await requiereSesionSuperadmin();
  const publicId = await imagenDeTicketSuperadmin(usuarioId, params.ticketId, params.archivo);
  if (!publicId) return NextResponse.json({ error: "No encontrado." }, { status: 404 });
  return responderImagenPrivada(publicId, "app/superadmin/soporte-imagen");
}
