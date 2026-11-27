import { cookies } from "next/headers";
import { NextRequest, NextResponse } from "next/server";
import { listarEmpresasDeUsuario } from "@/lib/empresas";
import { obtenerOCrearUsuarioActual } from "@/lib/usuarios";
import { requierePermiso, SinPermisoError } from "@/lib/permisos";
import { listarKardexParaExportar, TOPE_EXPORTAR_KARDEX } from "@/lib/inventario/stock";
import { armarCsv, fechaArchivoBogota, fechaIsoBogota, type ValorCsv } from "@/lib/csv-exportar";

// Mismo criterio que la pantalla del kardex: un id mal formado en la
// URL se ignora (no se le pasa a la base).
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function uuidValido(valor: string | null): string | undefined {
  return valor && UUID_RE.test(valor) ? valor : undefined;
}

// Issue #280 — «Descargar CSV» de /panel/inventario/kardex: los
// movimientos con los filtros puestos, lo más reciente primero (mismo
// orden que la pantalla). Route Handler porque devuelve un archivo
// crudo. Pide inventario.consultar; solo lee, por dbComoEmpresa (RLS).
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
    if (error instanceof SinPermisoError) return NextResponse.json({ error: "Tu rol no puede ver el kardex." }, { status: 403 });
    throw error;
  }

  const parametros = request.nextUrl.searchParams;
  const { filas, recortado } = await listarKardexParaExportar(empresa.id, {
    skuId: uuidValido(parametros.get("sku")),
    bodegaId: uuidValido(parametros.get("bodega")),
  });

  const encabezados = [
    "fecha",
    "tipo",
    "origen",
    "sku",
    "bodega",
    "delta_disponible",
    "delta_reservado",
    "saldo_disponible",
    "saldo_reservado",
    "actor",
    "referencia",
    "nota",
  ];
  const cuerpo: ValorCsv[][] = filas.map((f) => [
    fechaIsoBogota(f.ts),
    f.tipo,
    f.origen,
    f.skuCodigo,
    f.bodegaNombre,
    f.deltaDisponible,
    f.deltaReservado,
    f.saldoDisponible,
    f.saldoReservado,
    f.actorTipo === "sistema" ? "sistema" : (f.actorNombre ?? "persona"),
    f.referenciaId,
    f.nota,
  ]);
  if (recortado) cuerpo.push([`Archivo recortado a ${TOPE_EXPORTAR_KARDEX} filas: filtra por SKU o bodega para ver el resto`]);

  return new NextResponse(armarCsv(encabezados, cuerpo), {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="kardex-${fechaArchivoBogota()}.csv"`,
      "cache-control": "no-store",
    },
  });
}
