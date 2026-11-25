import { cookies } from "next/headers";
import { NextRequest, NextResponse } from "next/server";
import { listarEmpresasDeUsuario } from "@/lib/empresas";
import { pedirBinarioMl } from "@/lib/ml/cliente";
import { CuentaMlNoEncontradaError, listarCuentasConectadas, obtenerAccessTokenVigente } from "@/lib/ml/cuentas";
import { archivoMensajeValido, queryAdjuntoMensaje, rutaAdjuntoMensaje } from "@/lib/ml/mensajesPosventa";
import { requierePermiso, SinPermisoError } from "@/lib/permisos";
import { obtenerOCrearUsuarioActual } from "@/lib/usuarios";
import { esUuid } from "@/lib/validacion";

// Posventa-Mensajes (Refs #645) — proxy SOLO LECTURA de un adjunto de un
// mensaje de venta (GET /marketplace/messages/attachments/{id}?tag=post_sale
// &site_id=). El token nunca sale del servidor y el archivo no se guarda.
// Misma puerta que la pantalla: sesión + ventas consultar + cuenta de la
// empresa actual.
const TIPOS_SERVIBLES = new Set(["image/jpeg", "image/png", "image/gif", "application/pdf", "image/heic", "image/heif"]);

export async function GET(_request: NextRequest, { params }: { params: { cuentaId: string; archivo: string } }) {
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

  const { cuentaId, archivo } = params;
  if (!archivoMensajeValido(archivo)) return NextResponse.json({ error: "Datos inválidos." }, { status: 400 });
  if (!esUuid(cuentaId)) return NextResponse.json({ error: "No encontrado." }, { status: 404 });

  try {
    const cuenta = (await listarCuentasConectadas(empresa.id)).find((c) => c.id === cuentaId);
    if (!cuenta?.siteId) return NextResponse.json({ error: "No encontrado." }, { status: 404 });
    const token = await obtenerAccessTokenVigente(empresa.id, cuentaId);
    const resp = await pedirBinarioMl(rutaAdjuntoMensaje(archivo), token, queryAdjuntoMensaje(cuenta.siteId));
    if (!resp.ok) return NextResponse.json({ error: "No encontrado." }, { status: resp.status === 404 || resp.status === 403 ? 404 : 502 });
    const tipoMl = resp.tipo?.split(";")[0].trim().toLowerCase() ?? "";
    return new NextResponse(resp.data, {
      headers: {
        "content-type": TIPOS_SERVIBLES.has(tipoMl) ? tipoMl : "application/octet-stream",
        "cache-control": "private, max-age=300",
        "x-content-type-options": "nosniff",
        "content-disposition": `inline; filename="adjunto"`,
      },
    });
  } catch (error) {
    if (error instanceof CuentaMlNoEncontradaError) return NextResponse.json({ error: "No encontrado." }, { status: 404 });
    console.warn(`[api/ml/mensajes/adjuntos] no se pudo leer el adjunto: ${error instanceof Error ? error.name : "error"}`);
    return NextResponse.json({ error: "No se pudo obtener el adjunto de Mercado Libre." }, { status: 502 });
  }
}
