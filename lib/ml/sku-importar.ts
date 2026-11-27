// Issue #58 (Z-ML-09) — importa SKUs desde el CSV y, para los SKU
// NUEVOS, guarda su cantidad inicial como una entrada en el kardex
// (#57/#280 ya trajeron bodegas, stock_bodega y kardex_movimientos).
// Por qué así:
// - Solo los nuevos reciben stock: subir el mismo archivo dos veces
//   nunca suma doble, y un SKU que ya tenía movimientos no se "pisa"
//   con un número del archivo. La clave de idempotencia por SKU
//   (importacion-csv:stock-inicial:<skuId>) es una segunda red.
// - El stock entra SOLO por aplicarMovimientosTx, en la misma
//   transacción que crea los SKU: o entra todo o no entra nada, y cada
//   unidad deja su fila en el kardex (nunca un UPDATE a stock_bodega).
// - La bodega se resuelve por nombre entre las ACTIVAS de la empresa
//   (la RLS nunca deja ver una de otra empresa); si no existe, la fila
//   entera se omite — mejor un error visible que stock en otra bodega.
import { and, eq, inArray, sql } from "drizzle-orm";
import { dbComoEmpresa } from "@/db/empresa-context";
import { bodegas, skus } from "@/db/schema";
import { requierePermiso } from "@/lib/permisos";
import { registrarAuditoria } from "@/lib/auditoria";
import { aplicarMovimientosTx } from "@/lib/inventario/movimientos";
import {
  importarCsvSkus,
  type ErrorFilaCsv,
  type FilaSkuValida,
  type ResultadoImportarCsvSkus,
  type ResumenImportacionCsv,
} from "@/lib/importar-csv-skus";

// bodegaResuelta: el nombre real de la bodega donde entraría el stock
// (la de la fila o la principal); null si la fila no nombró bodega y la
// empresa no tiene principal. cargaStock: SKU nuevo con cantidad > 0.
export type FilaPreviaImportacion = FilaSkuValida & { yaExiste: boolean; bodegaResuelta: string | null; cargaStock: boolean };

export type ResumenPreviaImportacion = ResumenImportacionCsv & {
  nuevos: number;
  existentes: number;
};

export type VistaPreviaImportacionSku = {
  filas: FilaPreviaImportacion[];
  errores: ErrorFilaCsv[];
  resumen: ResumenPreviaImportacion;
};

export class SinFilasValidasError extends Error {
  constructor() {
    super("El archivo no tiene ninguna fila válida para importar — revisa los errores e intenta de nuevo.");
    this.name = "SinFilasValidasError";
  }
}

type Tx = Parameters<Parameters<typeof dbComoEmpresa>[1]>[0];
type BodegaDeEmpresa = { id: string; nombre: string; activa: boolean; esPrincipal: boolean };
type FilaConBodega = FilaSkuValida & { bodegaId: string | null; bodegaResuelta: string | null };

const TAMANO_LOTE_INSERT = 500;
const TAMANO_LOTE_CONSULTA = 1000;
const NOTA_STOCK_INICIAL = "Stock inicial (importación CSV)";

function enLotes<T>(elementos: T[], tamano: number): T[][] {
  const lotes: T[][] = [];
  for (let i = 0; i < elementos.length; i += tamano) lotes.push(elementos.slice(i, i + tamano));
  return lotes;
}

// Sin distinguir mayúsculas y sin espacios de más: "bodega  norte " y
// "Bodega Norte" son la misma para quien llena el CSV a mano.
function normalizarNombreBodega(nombre: string): string {
  return nombre.trim().replace(/\s+/g, " ").toLocaleLowerCase("es");
}

async function leerBodegasTx(tx: Tx, empresaId: string): Promise<BodegaDeEmpresa[]> {
  return tx
    .select({ id: bodegas.id, nombre: bodegas.nombre, activa: bodegas.activa, esPrincipal: bodegas.esPrincipal })
    .from(bodegas)
    .where(eq(bodegas.empresaId, empresaId));
}

// Resuelve la bodega de cada fila válida. Las que no se pueden resolver
// salen como error de fila y se quitan de las válidas (ni SKU ni stock).
function resolverBodegas(
  resultado: ResultadoImportarCsvSkus,
  bodegasEmpresa: BodegaDeEmpresa[]
): { filas: FilaConBodega[]; errores: ErrorFilaCsv[] } {
  // Si una activa y una desactivada se llaman igual tras normalizar, gana
  // la activa (se insertan primero las desactivadas para que la pise).
  const porNombre = new Map<string, BodegaDeEmpresa>();
  for (const b of [...bodegasEmpresa].sort((x, y) => Number(x.activa) - Number(y.activa))) {
    porNombre.set(normalizarNombreBodega(b.nombre), b);
  }
  const principal = bodegasEmpresa.find((b) => b.esPrincipal && b.activa) ?? null;

  const filas: FilaConBodega[] = [];
  const errores: ErrorFilaCsv[] = [...resultado.errores];
  for (const fila of resultado.filas) {
    const numeroFila = resultado.numeroFilaPorSku.get(fila.sku) ?? 0;
    if (fila.bodega) {
      const bodega = porNombre.get(normalizarNombreBodega(fila.bodega));
      if (!bodega) {
        errores.push({ numeroFila, columna: "bodega", mensaje: `La bodega "${fila.bodega}" no existe en tu empresa — revisa el nombre en /panel/bodegas.` });
      } else if (!bodega.activa) {
        errores.push({ numeroFila, columna: "bodega", mensaje: `La bodega "${bodega.nombre}" está desactivada: no puede recibir stock.` });
      } else {
        filas.push({ ...fila, bodegaId: bodega.id, bodegaResuelta: bodega.nombre });
      }
    } else if (principal) {
      filas.push({ ...fila, bodegaId: principal.id, bodegaResuelta: principal.nombre });
    } else if (fila.cantidadInicial > 0) {
      errores.push({ numeroFila, columna: "bodega", mensaje: "Crea una bodega en /panel/bodegas primero" });
    } else {
      filas.push({ ...fila, bodegaId: null, bodegaResuelta: null });
    }
  }
  return { filas, errores };
}

async function codigosExistentesTx(tx: Tx, empresaId: string, codigos: string[]): Promise<Set<string>> {
  const existentes = new Set<string>();
  for (const lote of enLotes(codigos, TAMANO_LOTE_CONSULTA)) {
    const filas = await tx
      .select({ codigo: skus.codigo })
      .from(skus)
      .where(and(eq(skus.empresaId, empresaId), inArray(skus.codigo, lote)));
    filas.forEach((f) => existentes.add(f.codigo));
  }
  return existentes;
}

// Vista previa — SOLO lectura, nunca escribe. importarCsvSkus() ya
// vuelve a validar el tamaño (5 MB) y el máximo de filas (20.000) acá
// mismo, del lado del servidor, sobre el texto real del archivo que
// llegó — nunca se confía en nada que el navegador diga de antemano
// (tamaño, número de filas, qué filas son válidas).
export async function previsualizarImportacionSkus(empresaId: string, usuarioId: string, textoCsv: string): Promise<VistaPreviaImportacionSku> {
  await requierePermiso(usuarioId, empresaId, "inventario", "modificar");

  const resultado = importarCsvSkus(textoCsv);
  if (resultado.filas.length === 0) {
    return { filas: [], errores: resultado.errores, resumen: { ...resultado.resumen, nuevos: 0, existentes: 0 } };
  }

  const { resueltas, errores, existentes } = await dbComoEmpresa(empresaId, async (tx) => {
    const { filas: resueltas, errores } = resolverBodegas(resultado, await leerBodegasTx(tx, empresaId));
    const existentes = await codigosExistentesTx(tx, empresaId, resueltas.map((f) => f.sku));
    return { resueltas, errores, existentes };
  });

  const filas: FilaPreviaImportacion[] = resueltas.map(({ bodegaId: _bodegaId, ...f }) => {
    const yaExiste = existentes.has(f.sku);
    return { ...f, yaExiste, cargaStock: !yaExiste && f.cantidadInicial > 0 };
  });
  const existentesCount = filas.filter((f) => f.yaExiste).length;

  return {
    filas,
    errores,
    resumen: {
      ...resultado.resumen,
      validas: filas.length,
      conError: new Set(errores.map((e) => e.numeroFila)).size,
      nuevos: filas.length - existentesCount,
      existentes: existentesCount,
    },
  };
}

export type ResultadoConfirmarImportacion = {
  creados: number;
  actualizados: number;
  // Existente, pero la fila del CSV no traía nombre — onConflictDoNothing
  // no tocó ninguna columna. Aparte de "actualizados" (que sí trajeron
  // nombre nuevo) para que el resumen no diga "actualizado" de algo que
  // en los hechos se dejó exactamente igual.
  sinCambios: number;
  omitidosPorError: number;
  // SKU nuevos que recibieron stock inicial, y cuántas unidades en total.
  stockCargado: number;
  unidadesCargadas: number;
};

// Confirmar — vuelve a parsear el MISMO texto desde cero y a resolver
// las bodegas (nunca recibe "la lista de filas válidas" de la vista
// previa: eso sería confiar en el navegador) y escribe todo en UNA
// sola transacción (dbComoEmpresa) — si algo falla a mitad de camino,
// Postgres deshace la transacción entera, nunca queda una importación
// a medias (ni un SKU sin su stock ni stock sin su SKU). Un insert por
// fila no escala con archivos grandes (hasta 20.000 filas, el tope de
// importarCsvSkus) — se agrupa en lotes de 500 por INSERT, y la
// consulta de "cuáles ya existen" en lotes de 1000 por IN(...).
//
// "Si un código ya existe": el issue #58 dice "crea O ACTUALIZA" —
// así que un código repetido actualiza el nombre del SKU existente
// (nunca lo crea de nuevo, nunca lo borra). Si la fila no trae nombre
// (columna opcional del CSV) y el SKU es nuevo, el nombre queda igual
// al código — nunca se inventa un nombre distinto; si el SKU ya
// existe y la fila no trae nombre, el nombre existente se deja como
// estaba (no se "actualiza" a vacío solo porque la columna faltaba).
export async function confirmarImportacionSkus(empresaId: string, usuarioId: string, textoCsv: string): Promise<ResultadoConfirmarImportacion> {
  await requierePermiso(usuarioId, empresaId, "inventario", "modificar");

  const resultado = importarCsvSkus(textoCsv);
  if (resultado.filas.length === 0) {
    throw new SinFilasValidasError();
  }

  return dbComoEmpresa(empresaId, async (tx) => {
    const { filas: resueltas, errores } = resolverBodegas(resultado, await leerBodegasTx(tx, empresaId));
    if (resueltas.length === 0) throw new SinFilasValidasError();

    // importarCsvSkus() ya descarta como ERROR cualquier sku repetido
    // dentro del mismo archivo (nunca llega acá dos veces) — esto es
    // una segunda red de seguridad, no el camino real hoy: un INSERT de
    // Postgres no deja que el mismo conflicto se resuelva dos veces en
    // una sola instrucción ("ON CONFLICT DO UPDATE command cannot
    // affect row a second time"). Si alguna vez se repite, se queda con
    // la ÚLTIMA aparición — Map.set sobrescribe el valor pero no cambia
    // la posición de la clave.
    const filasPorCodigo = new Map<string, FilaConBodega>();
    for (const fila of resueltas) filasPorCodigo.set(fila.sku, fila);
    const filasUnicas = [...filasPorCodigo.values()];

    const codigosExistentes = await codigosExistentesTx(tx, empresaId, filasUnicas.map((f) => f.sku));

    const conNombre = filasUnicas.filter((f) => f.nombre?.trim());
    const sinNombre = filasUnicas.filter((f) => !f.nombre?.trim());

    for (const lote of enLotes(conNombre, TAMANO_LOTE_INSERT)) {
      await tx
        .insert(skus)
        .values(lote.map((f) => ({ empresaId, codigo: f.sku, nombre: f.nombre!.trim() })))
        // excluded.nombre: el valor que traía CADA fila del lote, no un
        // solo nombre fijo compartido por todo el INSERT.
        .onConflictDoUpdate({ target: [skus.empresaId, skus.codigo], set: { nombre: sql`excluded.nombre` } });
    }

    for (const lote of enLotes(sinNombre, TAMANO_LOTE_INSERT)) {
      // Sin nombre en el CSV: un SKU nuevo nace con el código como
      // nombre (nunca uno inventado); uno que ya existe se deja
      // intacto — onConflictDoNothing no toca ninguna columna.
      await tx
        .insert(skus)
        .values(lote.map((f) => ({ empresaId, codigo: f.sku, nombre: f.sku })))
        .onConflictDoNothing({ target: [skus.empresaId, skus.codigo] });
    }

    let creados = 0;
    let actualizados = 0;
    let sinCambios = 0;
    for (const fila of filasUnicas) {
      const existia = codigosExistentes.has(fila.sku);
      const tieneNombre = Boolean(fila.nombre?.trim());
      if (!existia) creados++;
      else if (tieneNombre) actualizados++;
      else sinCambios++;
    }
    // Incluye las filas con bodega inválida: tampoco se escribieron.
    const omitidosPorError = errores.length;

    // Stock inicial: solo los SKU que NO existían antes de este archivo.
    const conStock = filasUnicas.filter((f) => !codigosExistentes.has(f.sku) && f.cantidadInicial > 0 && f.bodegaId);
    const idPorCodigo = new Map<string, string>();
    for (const lote of enLotes(conStock.map((f) => f.sku), TAMANO_LOTE_CONSULTA)) {
      const filasIds = await tx
        .select({ id: skus.id, codigo: skus.codigo })
        .from(skus)
        .where(and(eq(skus.empresaId, empresaId), inArray(skus.codigo, lote)));
      filasIds.forEach((f) => idPorCodigo.set(f.codigo, f.id));
    }

    let stockCargado = 0;
    let unidadesCargadas = 0;
    for (const fila of conStock) {
      const skuId = idPorCodigo.get(fila.sku);
      if (!skuId) throw new Error(`No se encontró el SKU recién creado "${fila.sku}".`);
      const movimiento = await aplicarMovimientosTx(tx, empresaId, {
        claveIdempotencia: `importacion-csv:stock-inicial:${skuId}`,
        // El enum de origen no tiene "importacion": la carga la hace una
        // persona desde la pantalla, así que es "manual".
        origen: "manual",
        actor: { tipo: "persona", usuarioId },
        nota: NOTA_STOCK_INICIAL,
        lineas: [{ tipo: "entrada", bodegaId: fila.bodegaId!, skuId, cantidad: fila.cantidadInicial }],
      });
      if (movimiento.aplicado) {
        stockCargado++;
        unidadesCargadas += fila.cantidadInicial;
      }
    }

    await registrarAuditoria(tx, {
      empresaId,
      usuarioId,
      actorTipo: "persona",
      accion: "importar_csv_skus",
      entidad: "sku",
      // Nunca el contenido del archivo — solo el resumen numérico.
      detalle: `Importó un CSV de SKUs: ${creados} creado(s), ${actualizados} actualizado(s), ${sinCambios} sin cambios, ${omitidosPorError} fila(s) con error omitida(s), ${stockCargado} SKU con stock inicial (${unidadesCargadas} unidades).`,
    });

    return { creados, actualizados, sinCambios, omitidosPorError, stockCargado, unidadesCargadas };
  });
}
