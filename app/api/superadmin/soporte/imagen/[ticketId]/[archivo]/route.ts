import { NextRequest, NextResponse } from "next/server";
import { responderImagenPrivada } from "@/lib/imagenes/responderPrivada";
import { requiereSesionSuperadmin } from "@/lib/superadmin";
import { imagenDeTicketSuperadmin } from "@/lib/soporte/superadmin";

// Capturas de tickets (25-nov) para el SUPERADMIN que atiende el ticket. Lo
// que el vendedor adjuntó a propósito, como el texto del ticket (D8). Exige
// la sesión propia del superadmin (cookie firmada); sin ella, al login aparte.
export async function GET(_request: NextRequest, { params }: { params: { ticketId: string; archivo: string } }) {
  const { usuarioId } = await requiereSesionSuperadmin();
  const publicId = await imagenDeTicketSuperadmin(usuarioId, params.ticketId, params.archivo);
  if (!publicId) return NextResponse.json({ error: "No encontrado." }, { status: 404 });
  return responderImagenPrivada(publicId, "app/api/superadmin/soporte/imagen");
}
