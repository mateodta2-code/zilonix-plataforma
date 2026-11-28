import { cookies } from "next/headers";
import { NextRequest, NextResponse } from "next/server";
import { listarEmpresasDeUsuario } from "@/lib/empresas";
import { obtenerOCrearUsuarioActual } from "@/lib/usuarios";
import { requierePermiso, SinPermisoError } from "@/lib/permisos";
import { normalizarParametro } from "@/lib/filtros-listado";
import { leerFichasProducto } from "@/lib/inventario/ficha-producto";
import { listarInventarioPorBodegaParaExportar, TOPE_EXPORTAR_INVENTARIO_BODEGA } from "@/lib/inventario/vista-inventario";
import { armarCsv, fechaArchivoBogota, type ValorCsv } from "@/lib/csv-exportar";

// Issue #280 — «Descargar CSV» de /panel/inventario: una fila por
// SKU+bodega, con las mismas columnas que la tabla, sin páginas. Route
// Handler (no Server Action) porque devuelve un archivo crudo. Mismo permiso que
// ver la pantalla: inventario.consultar. Solo lee, y solo por
// dbComoEmpresa (RLS).
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
    if (error instanceof SinPermisoError) return NextResponse.json({ error: "Tu rol no puede ver el inventario." }, { status: 403 });
    throw error;
  }

  const q = normalizarParametro(request.nextUrl.searchParams.get("q") ?? undefined);
  // Costo, venta y proveedor: solo con finanzas.consultar (igual que la tabla).
  let veFinanzas = true;
  try {
    await requierePermiso(usuario.id, empresa.id, "finanzas", "consultar");
  } catch (error) {
    if (!(error instanceof SinPermisoError)) throw error;
    veFinanzas = false;
  }
  const { filas, recortado } = await listarInventarioPorBodegaParaExportar(empresa.id, { busqueda: q });
  const unicos = new Map(filas.map((f) => [f.skuId, { id: f.skuId, codigo: f.codigo }]));
  const fichas = veFinanzas ? await leerFichasProducto(empresa.id, [...unicos.values()]) : new Map();

  // Mismas columnas y orden que la pantalla; una fila por SKU+bodega.
  // Un kit no tiene saldo propio: stock y bodega vacíos (el «—» de la tabla).
  const encabezados = ["sku", "nombre", ...(veFinanzas ? ["costo", "venta"] : []), "stock", "bodega", ...(veFinanzas ? ["proveedor"] : [])];
  const cuerpo: ValorCsv[][] = filas.map((f) => {
    const ficha = fichas.get(f.skuId);
    return [
      f.codigo,
      f.nombre,
      ...(veFinanzas ? [ficha?.costo ?? null, ficha?.precioVenta ?? null] : []),
      f.disponible,
      f.bodegaNombre,
      ...(veFinanzas ? [ficha?.proveedorNombre ?? null] : []),
    ];
  });
  if (recortado) cuerpo.push([`Archivo recortado a ${TOPE_EXPORTAR_INVENTARIO_BODEGA} filas: filtra por código o nombre para ver el resto`]);

  return new NextResponse(armarCsv(encabezados, cuerpo), {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="inventario-${fechaArchivoBogota()}.csv"`,
      "cache-control": "no-store",
    },
  });
}
