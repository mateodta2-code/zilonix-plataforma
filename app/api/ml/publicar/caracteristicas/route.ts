import { cookies } from "next/headers";
import { NextRequest, NextResponse } from "next/server";
import { listarEmpresasDeUsuario } from "@/lib/empresas";
import { obtenerOCrearUsuarioActual } from "@/lib/usuarios";
import { requierePermiso } from "@/lib/permisos";
import { leerCategoriaMl, SITE_ID } from "@/lib/ml/cliente";
import { obtenerAccessTokenVigente } from "@/lib/ml/cuentas";
import { obtenerCaracteristicasCategoria } from "@/lib/ml/publicar";

// ADENDO UX de Publicar, punto 3 — "atributos dinámicos con
// obtenerCaracteristicasCategoria (principales/secundarias, listas
// ≤60 + 'Otro')". La función de negocio ya existía (lib/ml/publicar.ts,
// §7) — le faltaba ruta. `categoriaId` es la categoría elegida a mano
// (buscador/árbol o un override ya guardado); sin ella, detecta por
// `titulo` (resolverCategoria, el mismo camino automático de siempre).
export async function GET(request: NextRequest) {
  const usuario = await obtenerOCrearUsuarioActual();
  if (!usuario) return NextResponse.json({ error: "Sin sesión." }, { status: 401 });

  const propias = await listarEmpresasDeUsuario(usuario.id);
  const empresaId = cookies().get("empresa_actual")?.value;
  const empresa = propias.find((e) => e.id === empresaId) ?? propias[0];
  if (!empresa) return NextResponse.json({ error: "Sin empresa activa." }, { status: 400 });

  await requierePermiso(usuario.id, empresa.id, "inventario", "crear");

  const cuentaId = request.nextUrl.searchParams.get("cuentaId");
  const titulo = request.nextUrl.searchParams.get("titulo")?.trim();
  if (!cuentaId || !titulo) return NextResponse.json({ error: "Faltan cuentaId/titulo." }, { status: 400 });
  const categoriaId = request.nextUrl.searchParams.get("categoriaId") || undefined;

  try {
    const token = await obtenerAccessTokenVigente(empresa.id, cuentaId);
    const datos = await obtenerCaracteristicasCategoria(SITE_ID, titulo, token, categoriaId);
    // Punto 5 del ADENDO — "galería por URL: respetar max_pictures" —
    // mismo GET /categories/{id} que obtenerCaracteristicasCategoria ya
    // usó internamente (leerAtributosCategoriaMl pide /attributes, no
    // el detalle con max_pictures_per_item); se pide una vez más acá,
    // nunca cacheado a ciegas, para que la UI sepa el tope real sin
    // que el formulario tenga que adivinarlo.
    const detalle = await leerCategoriaMl(datos.categoryId).catch(() => null);
    return NextResponse.json({ ...datos, maxPicturesPerItem: detalle?.maxPicturesPerItem ?? null });
  } catch (error) {
    const mensaje = error instanceof Error ? error.message : "Error leyendo las características de la categoría.";
    return NextResponse.json({ error: mensaje }, { status: 502 });
  }
}
