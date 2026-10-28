import { cookies } from "next/headers";
import { NextRequest, NextResponse } from "next/server";
import { listarEmpresasDeUsuario } from "@/lib/empresas";
import { obtenerOCrearUsuarioActual } from "@/lib/usuarios";
import { requierePermiso } from "@/lib/permisos";
import { SITE_ID } from "@/lib/ml/cliente";
import { obtenerAccessTokenVigente } from "@/lib/ml/cuentas";
import { leerArbolCategorias } from "@/lib/ml/publicar";

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

  await requierePermiso(usuario.id, empresa.id, "inventario", "crear");

  const cuentaId = request.nextUrl.searchParams.get("cuentaId");
  if (!cuentaId) return NextResponse.json({ error: "Falta cuentaId." }, { status: 400 });
  const categoryId = request.nextUrl.searchParams.get("categoryId") || undefined;

  try {
    const token = await obtenerAccessTokenVigente(empresa.id, cuentaId);
    const nodo = await leerArbolCategorias(SITE_ID, token, categoryId);
    return NextResponse.json(nodo);
  } catch (error) {
    const mensaje = error instanceof Error ? error.message : "Error leyendo el árbol de categorías.";
    return NextResponse.json({ error: mensaje }, { status: 502 });
  }
}
