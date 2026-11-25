import { cookies } from "next/headers";
import { NextRequest, NextResponse } from "next/server";
import { listarEmpresasDeUsuario } from "@/lib/empresas";
import { pedirBinarioMl } from "@/lib/ml/cliente";
import { CuentaMlNoEncontradaError, obtenerAccessTokenVigente } from "@/lib/ml/cuentas";
import { archivoAdjuntoValido, PATRON_ID_RECLAMO } from "@/lib/ml/reclamos";
import { requierePermiso, SinPermisoError } from "@/lib/permisos";
import { obtenerOCrearUsuarioActual } from "@/lib/usuarios";

// Reclamos-A (Refs #644) — proxy SOLO LECTURA de un adjunto que mandó el
// comprador en un reclamo (GET /post-purchase/v1/claims/{id}/attachments/
// {filename}/download). El token de la cuenta nunca sale del servidor; el
// archivo no se guarda. Misma puerta que la pantalla: sesión + ventas
// consultar, y la cuenta tiene que ser de la empresa actual (RLS).
const PATRON_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// Lo que ML deja adjuntar (JPG/PNG/PDF/TXT); cualquier otro tipo se sirve
// como descarga genérica, nunca como página.
const TIPOS_SERVIBLES = new Set(["image/jpeg", "image/png", "application/pdf", "text/plain"]);

export async function GET(_request: NextRequest, { params }: { params: { cuentaId: string; reclamoId: string; archivo: string } }) {
  const usuario = await obtenerOCrearUsuarioActual();
  if (!usuario) return NextResponse.json({ error: "Sin sesión." }, { status: 401 });

  const propias = await listarEmpresasDeUsuario(usuario.id);
  const empresaId = cookies().get("empresa_actual")?.value;
  const empresa = propias.find((e) => e.id === empresaId) ?? propias[0];
  if (!empresa) return NextResponse.json({ error: "Sin empresa activa." }, { status: 400 });

  try {
    await requierePermiso(usuario.id, empresa.id, "ventas", "consultar");
  } catch (error) {
    if (error instanceof SinPermisoError) return NextResponse.json({ error: "Sin permiso." }, { status: 403 });
    throw error;
  }

  const { cuentaId, reclamoId, archivo } = params;
  if (!PATRON_ID_RECLAMO.test(reclamoId) || !archivoAdjuntoValido(archivo)) {
    return NextResponse.json({ error: "Datos inválidos." }, { status: 400 });
  }
  if (!PATRON_UUID.test(cuentaId)) return NextResponse.json({ error: "No encontrado." }, { status: 404 });

  try {
    const token = await obtenerAccessTokenVigente(empresa.id, cuentaId);
    const resp = await pedirBinarioMl(`/post-purchase/v1/claims/${reclamoId}/attachments/${archivo}/download`, token);
    if (!resp.ok) {
      return NextResponse.json({ error: "No encontrado." }, { status: resp.status === 404 || resp.status === 403 ? 404 : 502 });
    }
    // Content-Type de ML solo si es uno de los 4 permitidos; si no, por firma.
    const tipoMl = resp.tipo?.split(";")[0].trim().toLowerCase() ?? "";
    const tipo = TIPOS_SERVIBLES.has(tipoMl) ? tipoMl : tipoPorFirma(resp.data);
    return new NextResponse(resp.data, {
      headers: {
        "content-type": tipo,
        "cache-control": "private, max-age=300",
        "x-content-type-options": "nosniff",
        "content-disposition": `inline; filename="adjunto"`,
      },
    });
  } catch (error) {
    // Cuenta ajena o inexistente: sin datos, igual que un reclamo ajeno.
    if (error instanceof CuentaMlNoEncontradaError) return NextResponse.json({ error: "No encontrado." }, { status: 404 });
    console.warn(`[api/ml/reclamos/adjuntos] no se pudo leer el adjunto: ${error instanceof Error ? error.name : "error"}`);
    return NextResponse.json({ error: "No se pudo obtener el adjunto de Mercado Libre." }, { status: 502 });
  }
}

// Respaldo cuando ML no manda un tipo permitido: se deduce de los primeros
// bytes, nunca del nombre que mandó el comprador. Lo desconocido se sirve
// como descarga genérica (nunca como página).
function tipoPorFirma(datos: ArrayBuffer): string {
  const b = new Uint8Array(datos.slice(0, 4));
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "image/jpeg";
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return "image/png";
  if (b[0] === 0x25 && b[1] === 0x50 && b[2] === 0x44 && b[3] === 0x46) return "application/pdf";
  return "application/octet-stream";
}
