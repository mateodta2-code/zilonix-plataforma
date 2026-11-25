import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import { dbComoEmpresa } from "@/db/empresa-context";
import { cuentasMl, productosMl } from "@/db/schema";
import { listarEmpresasDeUsuario } from "@/lib/empresas";
import { obtenerOCrearUsuarioActual } from "@/lib/usuarios";
import { requierePermiso } from "@/lib/permisos";
import { respuestaSiSinPermiso } from "../_ayudantes";

const PATRON_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Barra de avance del historial de Publicar: consulta MÍNIMA de UNA
// publicación → { estado, hechos, total }. Nunca trae el historial ni el
// jsonb completo (el largo se calcula en la base). Mismo permiso que ver
// el historial ("inventario","consultar") y RLS por empresa con
// dbComoEmpresa: un id de otra empresa responde 404. `total` usa el mismo
// criterio que publicarProductoEnCuentas (seleccionadas, o todas las
// activas si no hay selección). No llama a Mercado Libre.
export async function GET(request: NextRequest) {
  const usuario = await obtenerOCrearUsuarioActual();
  if (!usuario) return NextResponse.json({ error: "Sin sesión." }, { status: 401 });

  const propias = await listarEmpresasDeUsuario(usuario.id);
  const empresaId = cookies().get("empresa_actual")?.value;
  const empresa = propias.find((e) => e.id === empresaId) ?? propias[0];
  if (!empresa) return NextResponse.json({ error: "Sin empresa activa." }, { status: 400 });

  try {
    await requierePermiso(usuario.id, empresa.id, "inventario", "consultar");
  } catch (error) {
    const respuestaPermiso = respuestaSiSinPermiso(error);
    if (respuestaPermiso) return respuestaPermiso;
    throw error;
  }

  const id = request.nextUrl.searchParams.get("id");
  if (!id || !PATRON_UUID.test(id)) return NextResponse.json({ error: "id inválido." }, { status: 400 });

  const resultado = await dbComoEmpresa(empresa.id, async (tx) => {
    const [fila] = await tx
      .select({
        estado: productosMl.estado,
        hechos: sql<number>`coalesce(jsonb_array_length(${productosMl.resultado}), 0)::int`,
        seleccionadas: productosMl.cuentasSeleccionadas,
      })
      .from(productosMl)
      .where(and(eq(productosMl.id, id), eq(productosMl.empresaId, empresa.id)));
    if (!fila) return null;
    const seleccionadas = fila.seleccionadas ?? [];
    const [{ total }] = await tx
      .select({ total: sql<number>`count(*)::int` })
      .from(cuentasMl)
      .where(
        and(
          eq(cuentasMl.empresaId, empresa.id),
          isNull(cuentasMl.desconectadaTs),
          ...(seleccionadas.length ? [inArray(cuentasMl.id, seleccionadas)] : [])
        )
      );
    return { estado: fila.estado, hechos: fila.hechos, total };
  });

  if (!resultado) return NextResponse.json({ error: "No se encontró esa publicación." }, { status: 404 });
  return NextResponse.json(resultado);
}
