import { cookies } from "next/headers";
import { NextRequest, NextResponse } from "next/server";
import { descargarFotoPrivada } from "@/lib/cloudinary";
import { listarEmpresasDeUsuario } from "@/lib/empresas";
import { fotoDeEntrega } from "@/lib/entregas/entregas";
import { requierePermiso, SinPermisoError } from "@/lib/permisos";
import { obtenerOCrearUsuarioActual } from "@/lib/usuarios";
import { esUuid } from "@/lib/validacion";

// Domi-3 — la foto de entrega para el VENDEDOR (Despachos → «Ver foto»).
// Route Handler y no Server Action: devuelve la imagen cruda. La foto es
// privada en Cloudinary; acá se comprueba sesión, permiso de ventas y que
// la entrega sea de la empresa activa (RLS en fotoDeEntrega), y recién ahí
// el servidor la descarga firmada. La URL de Cloudinary nunca sale de acá.
export async function GET(_request: NextRequest, { params }: { params: { entregaId: string } }) {
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

  if (!esUuid(params.entregaId)) return NextResponse.json({ error: "No encontrado." }, { status: 404 });
  const publicId = await fotoDeEntrega(empresa.id, params.entregaId);
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
    console.error("[app/api/entregas/foto] no se pudo descargar la foto:", error instanceof Error ? error.name : error);
    return NextResponse.json({ error: "No se pudo cargar la foto." }, { status: 502 });
  }
}
