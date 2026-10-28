import { and, eq } from "drizzle-orm";
import { dbComoEmpresa } from "@/db/empresa-context";
import { metasMensuales } from "@/db/schema";
import { registrarAuditoria } from "@/lib/auditoria";

// Issue #125 — la meta de utilidad (después de publicidad) es por
// empresa y por mes. Mes sin fila = sin meta: esta lectura devuelve
// null, no 0 ni la meta del mes anterior.
//
// Solo el Dueño la puede cambiar. Ese chequeo (`requiereDueno`) vive
// en la acción del issue #126; la RLS de esta tabla solo aísla por
// empresa. Acá no hay ruta.

const MES_DIA_UNO = /^\d{4}-\d{2}-01$/;
const UTILIDAD = /^\d+(\.\d{1,2})?$/;

export class MetaMensualInvalidaError extends Error {
  constructor(mensaje: string) {
    super(mensaje);
    this.name = "MetaMensualInvalidaError";
  }
}

export async function leerMetaMensual(empresaId: string, mes: string, moneda = "COP") {
  return dbComoEmpresa(empresaId, async (tx) => {
    const [fila] = await tx
      .select()
      .from(metasMensuales)
      .where(and(eq(metasMensuales.empresaId, empresaId), eq(metasMensuales.mes, mes), eq(metasMensuales.moneda, moneda)));
    return fila ?? null;
  });
}

export async function guardarMetaMensual(entrada: {
  empresaId: string;
  usuarioId: string;
  mes: string;
  metaUtilidad: string;
  moneda?: string;
}): Promise<{ id: string }> {
  if (!MES_DIA_UNO.test(entrada.mes)) {
    throw new MetaMensualInvalidaError("El mes de la meta tiene que ser el día 1 (por ejemplo 2026-10-01).");
  }
  if (!UTILIDAD.test(entrada.metaUtilidad)) {
    throw new MetaMensualInvalidaError("La meta de utilidad tiene que ser un número mayor o igual a 0, con hasta 2 decimales.");
  }
  const moneda = entrada.moneda ?? "COP";

  return dbComoEmpresa(entrada.empresaId, async (tx) => {
    const [previa] = await tx
      .select()
      .from(metasMensuales)
      .where(and(eq(metasMensuales.empresaId, entrada.empresaId), eq(metasMensuales.mes, entrada.mes), eq(metasMensuales.moneda, moneda)));

    let id: string;
    if (!previa) {
      const [fila] = await tx
        .insert(metasMensuales)
        .values({
          empresaId: entrada.empresaId,
          mes: entrada.mes,
          metaUtilidad: entrada.metaUtilidad,
          moneda,
          actualizadaPor: entrada.usuarioId,
        })
        .returning({ id: metasMensuales.id });
      id = fila.id;
    } else {
      id = previa.id;
      await tx
        .update(metasMensuales)
        .set({ metaUtilidad: entrada.metaUtilidad, actualizadaPor: entrada.usuarioId, actualizadaTs: new Date() })
        .where(eq(metasMensuales.id, id));
    }

    await registrarAuditoria(tx, {
      empresaId: entrada.empresaId,
      usuarioId: entrada.usuarioId,
      actorTipo: "persona",
      accion: previa ? "modificar" : "crear",
      entidad: "meta_mensual",
      entidadId: id,
      detalle: `Guardó la meta de ${entrada.mes} (${moneda}).`,
      valorAnterior: previa?.metaUtilidad,
      valorNuevo: entrada.metaUtilidad,
    });
    return { id };
  });
}
