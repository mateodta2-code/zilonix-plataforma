import { cookies } from "next/headers";
import { NextRequest, NextResponse } from "next/server";
import { listarEmpresasDeUsuario } from "@/lib/empresas";
import { obtenerOCrearUsuarioActual } from "@/lib/usuarios";
import { requierePermiso } from "@/lib/permisos";
import { PATRON_ID_CATEGORIA } from "@/lib/ml/cliente";
import { obtenerAccessTokenVigente, obtenerSitioDeCuenta } from "@/lib/ml/cuentas";
import { leerArbolCategorias } from "@/lib/ml/publicar";
import { respuestaDeErrorMl, respuestaSiCategoryIdInvalido, respuestaSiCuentaIdInvalido, respuestaSiSinPermiso } from "../../_ayudantes";

// ADENDO UX de Publicar, punto 2 — "árbol de categorías: UI + ruta que
// liste raíces/hijos (patrón OS app/api/ml/categorias-arbol)". Sin
// `categoryId` trae la raíz real del sitio; con `categoryId`, el
// siguiente nivel + el breadcrumb (pathFromRoot). Mismo permiso que
// crear el producto — esto solo AYUDA a elegir la categoría.
export async function GET(request: NextRequest) {
  const usuario = await obtenerOCrearUsuarioActual();
  if (!usuario) return NextResponse.json({ error: "Sin sesión." }, { status: 401 });

  const propias = await listarEmpresasDeUsuario(usuario.id);
  const empresaId = cookies().get("empresa_actual")?.value;
  const empresa = propias.find((e) => e.id === empresaId) ?? propias[0];
  if (!empresa) return NextResponse.json({ error: "Sin empresa activa." }, { status: 400 });

  try {
    await requierePermiso(usuario.id, empresa.id, "inventario", "crear");
  } catch (error) {
    const respuestaPermiso = respuestaSiSinPermiso(error);
    if (respuestaPermiso) return respuestaPermiso;
    throw error;
  }

  const cuentaId = request.nextUrl.searchParams.get("cuentaId");
  const categoryIdCrudo = request.nextUrl.searchParams.get("categoryId");
  // Code review de Pablo, punto 2 — formato de cuentaId/categoryId
  // validado ANTES de tocar la base/Mercado Libre.
  const respuestaCuenta = respuestaSiCuentaIdInvalido(cuentaId);
  if (respuestaCuenta) return respuestaCuenta;
  const respuestaCategoria = respuestaSiCategoryIdInvalido(categoryIdCrudo, PATRON_ID_CATEGORIA);
  if (respuestaCategoria) return respuestaCategoria;
  const categoryId = categoryIdCrudo || undefined;

  try {
    const token = await obtenerAccessTokenVigente(empresa.id, cuentaId as string);
    const { siteId } = await obtenerSitioDeCuenta(empresa.id, cuentaId as string);
    const nodo = await leerArbolCategorias(siteId, token, categoryId);
    return NextResponse.json(nodo);
  } catch (error) {
    return respuestaDeErrorMl(error);
  }
}
