import { NextRequest } from "next/server";
import { fotoDeNovedad } from "@/lib/entregas/novedades";
import { responderFotoDeEmpresa } from "@/lib/entregas/responderFoto";

// Domi-4 — la foto de una novedad del domiciliario para el VENDEDOR
// (Despachos → «Ver foto»). Mismas comprobaciones que la foto de entrega.
export async function GET(_request: NextRequest, { params }: { params: { novedadId: string } }) {
  return responderFotoDeEmpresa(params.novedadId, fotoDeNovedad, "app/api/entregas/novedades/foto");
}
