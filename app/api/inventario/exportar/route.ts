import { cookies } from "next/headers";
import { NextRequest, NextResponse } from "next/server";
import { listarEmpresasDeUsuario } from "@/lib/empresas";
import { obtenerOCrearUsuarioActual } from "@/lib/usuarios";
import { requierePermiso, SinPermisoError } from "@/lib/permisos";
import { normalizarParametro } from "@/lib/filtros-listado";
import { listarBodegas } from "@/lib/inventario/bodegas";
import { calcularDiasStock, cantidadAPublicar } from "@/lib/inventario/calculos";
import { leerConfiguracionInventario } from "@/lib/inventario/configuracion";
import { listarInventarioParaExportar, TOPE_EXPORTAR_INVENTARIO } from "@/lib/inventario/stock";
import { armarCsv, fechaArchivoBogota, type ValorCsv } from "@/lib/csv-exportar";

// Issue #280 — «Descargar CSV» de /panel/inventario: el stock por SKU y
// bodega, como se ve en la tabla pero sin páginas. Route Handler (no
// Server Action) porque devuelve un archivo crudo. Mismo permiso que
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
  const [{ filas, recortado }, lista, config] = await Promise.all([
    listarInventarioParaExportar(empresa.id, { busqueda: q }),
    listarBodegas(empresa.id),
    leerConfiguracionInventario(empresa.id),
  ]);

  // Mismas columnas que la pantalla: bodegas activas más las
  // desactivadas que todavía tienen algo (para no esconder stock real).
  const conSaldo = new Set(filas.flatMap((f) => f.porBodega.filter((b) => b.disponible || b.reservado).map((b) => b.bodegaId)));
  const columnas = lista.filter((b) => b.activa || conSaldo.has(b.id));

  const encabezados = ["sku", "nombre", "tipo", ...columnas.map((b) => b.nombre), "reservado", "para_ml", "dias_stock"];
  const cuerpo: ValorCsv[][] = filas.map((f) => [
    f.codigo,
    f.nombre,
    f.esKit ? "kit" : "simple",
    // Un kit no tiene saldo propio por bodega: vacío, como el «—» de la tabla.
    ...columnas.map((b) => (f.esKit ? null : (f.porBodega.find((x) => x.bodegaId === b.id)?.disponible ?? 0))),
    f.esKit ? null : f.totalReservado,
    cantidadAPublicar(f.publicable, config.bufferMl),
    diasStockCsv(f.esKit, cantidadAPublicar(f.publicable, config.bufferMl), f.vendidas30),
  ]);
  if (recortado) cuerpo.push([`Archivo recortado a ${TOPE_EXPORTAR_INVENTARIO} filas: filtra por código o nombre para ver el resto`]);

  return new NextResponse(armarCsv(encabezados, cuerpo), {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="inventario-${fechaArchivoBogota()}.csv"`,
      "cache-control": "no-store",
    },
  });
}

// Mismo número que la tabla; vacío si no hay ventas o es kit (en la
// tabla, «sin ventas» y «—»). Más de 365 va el número real y no «+365»:
// armarCsv le antepone ' a toda celda que empiece con + (para que no se
// ejecute como fórmula), y un número se puede ordenar en Excel.
function diasStockCsv(esKit: boolean, paraMl: number, vendidas30: number): ValorCsv {
  if (esKit) return null;
  return calcularDiasStock(paraMl, vendidas30);
}
