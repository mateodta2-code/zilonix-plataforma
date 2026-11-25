import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { descargarFotoPrivada } from "@/lib/cloudinary";
import { listarEmpresasDeUsuario } from "@/lib/empresas";
import { requierePermiso, SinPermisoError } from "@/lib/permisos";
import { obtenerOCrearUsuarioActual } from "@/lib/usuarios";
import { esUuid } from "@/lib/validacion";

// Domi-3/Domi-4 — responde una foto privada de entregas al VENDEDOR. Comprueba
// sesión, ventas.consultar y empresa activa; `buscar` lee el public_id con
// RLS de esa empresa (null si no es suya o no tiene foto). Recién ahí el
// servidor la descarga firmada; la URL de Cloudinary nunca sale de acá.
export async function responderFotoDeEmpresa(id: string, buscar: (empresaId: string, id: string) => Promise<string | null>, origen: string): Promise<NextResponse> {
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

  if (!esUuid(id)) return NextResponse.json({ error: "No encontrado." }, { status: 404 });
  const publicId = await buscar(empresa.id, id);
  if (!publicId) return NextResponse.json({ error: "No encontrado." }, { status: 404 });

  try {
    const { bytes, contentType } = await descargarFotoPrivada(publicId);
    return new NextResponse(bytes, {
      headers: {
        "Content-Type": contentType.startsWith("image/") ? contentType : "image/jpeg",
        // Dato personal del comprador: nunca en caché compartida.
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    console.error(`[${origen}] no se pudo descargar la foto:`, error instanceof Error ? error.name : error);
    return NextResponse.json({ error: "No se pudo cargar la foto." }, { status: 502 });
  }
}
