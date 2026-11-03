import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { listarEmpresasDeUsuario } from "@/lib/empresas";
import { obtenerOCrearUsuarioActual } from "@/lib/usuarios";
import { requierePermiso } from "@/lib/permisos";
import { obtenerAccessTokenVigente } from "@/lib/ml/cuentas";
import { obtenerFotoItemMl, PATRON_ID_PRODUCTO_O_ITEM } from "@/lib/ml/cliente";
import { respuestaDeErrorMl, respuestaSiCuentaIdInvalido, respuestaSiSinPermiso } from "../../_ayudantes";

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

  try {
    const token = await obtenerAccessTokenVigente(empresa.id, cuentaId as string);
    const foto = await obtenerFotoItemMl(itemId, token);
    if (!foto || !foto.estado) {
      return NextResponse.json({ error: "Mercado Libre no devolvió el estado de esta publicación." }, { status: 502 });
    }
    return NextResponse.json({ status: foto.estado });
  } catch (error) {
    return respuestaDeErrorMl(error);
  }
}
