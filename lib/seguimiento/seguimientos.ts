import { and, eq, isNull } from "drizzle-orm";
import { dbComoEmpresa } from "@/db/empresa-context";
import { seguimientosMl } from "@/db/schema";

// Issue #175 — "máximo 5 competidores por empresa, validado en el
// servidor": literal, acá vive el candado. No es una constraint de
// Postgres (un trigger de conteo agregaría SQL a mano por algo que la
// propia aplicación ya puede chequear antes de insertar, dentro de la
// misma transacción de dbComoEmpresa) — es intencional, pedido así en
// el issue.
export const LIMITE_COMPETIDORES_POR_EMPRESA = 5;

export class LimiteCompetidoresError extends Error {
  constructor() {
    super(`Esta empresa ya tiene ${LIMITE_COMPETIDORES_POR_EMPRESA} competidores marcados — quita uno antes de agregar otro.`);
    this.name = "LimiteCompetidoresError";
  }
}

// Nunca cuenta un seguimiento ya eliminado (eliminado_ts) — quitar un
// competidor libera cupo real, no uno que sigue "gastado" para
// siempre.
export async function contarCompetidoresActivos(empresaId: string): Promise<number> {
  return dbComoEmpresa(empresaId, async (tx) => {
    const filas = await tx
      .select({ id: seguimientosMl.id })
      .from(seguimientosMl)
      .where(and(eq(seguimientosMl.empresaId, empresaId), eq(seguimientosMl.esCompetidor, true), isNull(seguimientosMl.eliminadoTs)));
    return filas.length;
  });
}

// Se llama ANTES de insertar un seguimiento nuevo marcado como
// competidor (o de marcar uno existente como competidor) — lanza
// LimiteCompetidoresError en vez de dejar pasar un sexto en silencio.
// Nota real: esto no es un candado atómico contra una carrera exacta
// (dos peticiones a la vez podrían las dos leer 4 y las dos insertar)
// — aceptable a propósito para una acción de panel de administración,
// de volumen bajísimo, nunca un endpoint de alto tráfico; si algún día
// hiciera falta un candado real, sería un UPDATE con RETURNING contra
// un contador dedicado, no esto.
export async function verificarCupoCompetidor(empresaId: string): Promise<void> {
  const actuales = await contarCompetidoresActivos(empresaId);
  if (actuales >= LIMITE_COMPETIDORES_POR_EMPRESA) {
    throw new LimiteCompetidoresError();
  }
}
