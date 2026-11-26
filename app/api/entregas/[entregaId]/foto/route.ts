import { NextRequest } from "next/server";
import { fotoDeEntrega } from "@/lib/entregas/entregas";
import { responderFotoDeEmpresa } from "@/lib/entregas/responderFoto";

// Domi-3 — la foto de entrega para el VENDEDOR (Despachos → «Ver foto de la
// entrega»). Route Handler: devuelve la imagen cruda. Sesión, permiso
// (ventas.consultar) y empresa (RLS) se comprueban en responderFotoDeEmpresa.
export async function GET(_request: NextRequest, { params }: { params: { entregaId: string } }) {
  return responderFotoDeEmpresa(params.entregaId, fotoDeEntrega, "app/api/entregas/foto");
}
