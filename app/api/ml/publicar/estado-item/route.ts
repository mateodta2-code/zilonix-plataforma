import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { eq } from "drizzle-orm";
import { dbComoEmpresa } from "@/db/empresa-context";
import { productosMl } from "@/db/schema";
import { listarEmpresasDeUsuario } from "@/lib/empresas";
import { obtenerOCrearUsuarioActual } from "@/lib/usuarios";
import { requierePermiso } from "@/lib/permisos";
import { obtenerAccessTokenVigente } from "@/lib/ml/cuentas";
import { obtenerFotoItemMl, PATRON_ID_PRODUCTO_O_ITEM } from "@/lib/ml/cliente";
import { resultadoContieneItemDeCuenta } from "@/app/panel/publicar/formulario-logica";
import { respuestaDeErrorMl, respuestaSiCuentaIdInvalido, respuestaSiSinPermiso } from "../_ayudantes";

// Historial de Publicar, botón "Ver estado real" — el detalle
// desplegado en la MISMA fila (HistorialPublicaciones.tsx) guarda el
// `status` tal cual quedó en productos_ml al publicar (puede estar
// viejo: la persona pudo pausarla/reactivarla después, directo en
// Mercado Libre). Esta ruta consulta el estado ACTUAL de un solo ítem,
// de una sola cuenta, sin recargar la página — mismo permiso que ver
// el historial en sí ("inventario","consultar": solo LEE, nunca
// publica ni cambia nada).
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

  const cuentaId = request.nextUrl.searchParams.get("cuentaId");
  const respuestaId = respuestaSiCuentaIdInvalido(cuentaId);
  if (respuestaId) return respuestaId;

  const itemId = request.nextUrl.searchParams.get("itemId");
  if (!itemId || !PATRON_ID_PRODUCTO_O_ITEM.test(itemId)) {
    return NextResponse.json({ error: "itemId inválido." }, { status: 400 });
  }

  // Revisión del PR #371 (hallazgo IMPORTANTE) — antes de llamar a
  // Mercado Libre, confirma que ese itemId es de verdad una
  // publicación del historial de ESTA empresa, en esa misma cuenta
  // (dbComoEmpresa aplica RLS: nunca ve filas de otra empresa). Sin
  // esto, cualquier persona con sesión podía pedir el estado real de un
  // itemId ajeno con solo adivinar el id — nunca se llega a
  // obtenerAccessTokenVigente/obtenerFotoItemMl si no pertenece.
  const filas = await dbComoEmpresa(empresa.id, (tx) =>
    tx.select({ resultado: productosMl.resultado }).from(productosMl).where(eq(productosMl.empresaId, empresa.id))
  );
  const perteneceAEmpresa = filas.some((fila) => resultadoContieneItemDeCuenta(fila.resultado, itemId, cuentaId as string));
  if (!perteneceAEmpresa) {
    return NextResponse.json({ error: "No se encontró esa publicación en el historial de esta empresa." }, { status: 404 });
  }

  try {
    const token = await obtenerAccessTokenVigente(empresa.id, cuentaId as string);
    const foto = await obtenerFotoItemMl(itemId, token);
    if (!foto || !foto.estado) {
      return NextResponse.json({ error: "Mercado Libre no devolvió el estado de esta publicación." }, { status: 502 });
    }
    // sub_status queda null hasta que exista el helper fino pendiente
    // (ver docs/changelog/pendientes/fix-publicar-historial-detalle.md)
    // — obtenerFotoItemMl no lo pide todavía y lib/ml/cliente.ts no se
    // toca en esta tarea.
    return NextResponse.json({ status: foto.estado, subStatus: null as string | null });
  } catch (error) {
    return respuestaDeErrorMl(error);
  }
}
