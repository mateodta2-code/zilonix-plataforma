// Issue #58 (Z-ML-09) — la mitad que esperaba al #57 (Z-ML-06,
// movimientos de stock auditados): acá SÍ se toca Postgres, pero
// SOLO la tabla skus (código + nombre). El propio issue pide "crea o
// actualiza SKUs y stock inicial como movimientos `importacion`" — la
// parte de "stock inicial como movimiento" necesita la tabla
// stock_movimientos de #57, que todavía no existe en db/schema.ts (ni
// la tabla bodegas). Sin esa tabla no hay manera de guardar la
// cantidad/bodega de cada fila sin inventar una columna o una
// migración nueva — y la tarea pide explícitamente no hacer eso sin
// avisar antes. Por eso acá se importa el código y el nombre del SKU
// nomás; cantidadInicial/bodega se siguen leyendo y se muestran en la
// vista previa (son datos reales del archivo, útiles para revisar),
// pero no se escriben en ningún lado todavía — quedan documentados
// como pendientes de #57 en el changelog de esta tarea.
import { and, eq, inArray } from "drizzle-orm";
import { dbComoEmpresa } from "@/db/empresa-context";
import { skus } from "@/db/schema";
import { requierePermiso } from "@/lib/permisos";
import { registrarAuditoria } from "@/lib/auditoria";
import { importarCsvSkus, type ErrorFilaCsv, type FilaSkuValida, type ResumenImportacionCsv } from "@/lib/importar-csv-skus";

export type FilaPreviaImportacion = FilaSkuValida & { yaExiste: boolean };

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

  const codigos = resultado.filas.map((f) => f.sku);
  const existentes = await dbComoEmpresa(empresaId, (tx) =>
    tx
      .select({ codigo: skus.codigo })
      .from(skus)
      .where(and(eq(skus.empresaId, empresaId), inArray(skus.codigo, codigos)))
  );
  const codigosExistentes = new Set(existentes.map((e) => e.codigo));

  const filas: FilaPreviaImportacion[] = resultado.filas.map((f) => ({ ...f, yaExiste: codigosExistentes.has(f.sku) }));
  const existentesCount = filas.filter((f) => f.yaExiste).length;

  return {
    filas,
    errores: resultado.errores,
    resumen: { ...resultado.resumen, nuevos: filas.length - existentesCount, existentes: existentesCount },
  };
}

export type ResultadoConfirmarImportacion = {
  creados: number;
  actualizados: number;
  omitidosPorError: number;
};

// Confirmar — vuelve a parsear el MISMO texto desde cero (nunca
// recibe "la lista de filas válidas" de la vista previa: eso sería
// confiar en el navegador) y escribe todas las filas válidas en UNA
// sola transacción (dbComoEmpresa) — si algo falla a mitad de camino,
// Postgres deshace la transacción entera, nunca queda una importación
// a medias.
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
    const codigos = resultado.filas.map((f) => f.sku);
    const existentesAntes = await tx
      .select({ codigo: skus.codigo })
      .from(skus)
      .where(and(eq(skus.empresaId, empresaId), inArray(skus.codigo, codigos)));
    const codigosExistentes = new Set(existentesAntes.map((e) => e.codigo));

    for (const fila of resultado.filas) {
      const nombre = fila.nombre?.trim();
      if (nombre) {
        await tx
          .insert(skus)
          .values({ empresaId, codigo: fila.sku, nombre })
          .onConflictDoUpdate({ target: [skus.empresaId, skus.codigo], set: { nombre } });
      } else {
        // Sin nombre en el CSV: un SKU nuevo nace con el código como
        // nombre (nunca uno inventado); uno que ya existe se deja
        // intacto — onConflictDoNothing no toca ninguna columna.
        await tx
          .insert(skus)
          .values({ empresaId, codigo: fila.sku, nombre: fila.sku })
          .onConflictDoNothing({ target: [skus.empresaId, skus.codigo] });
      }
    }

    const creados = resultado.filas.filter((f) => !codigosExistentes.has(f.sku)).length;
    const actualizados = resultado.filas.length - creados;
    const omitidosPorError = resultado.errores.length;

    await registrarAuditoria(tx, {
      empresaId,
      usuarioId,
      actorTipo: "persona",
      accion: "importar_csv_skus",
      entidad: "sku",
      // Nunca el contenido del archivo — solo el resumen numérico.
      detalle: `Importó un CSV de SKUs: ${creados} creado(s), ${actualizados} actualizado(s), ${omitidosPorError} fila(s) con error omitida(s).`,
    });

    return { creados, actualizados, omitidosPorError };
  });
}
