// Optimización — competidores leídos con la extensión, guardados por
// publicación (tabla optimizacion_competidores_ext, una fila por
// empresa+publicación: la última lectura). Lo que llega de la página se
// vuelve a validar acá: el servidor nunca confía en el navegador.

import { and, eq } from "drizzle-orm";
import { dbComoEmpresa } from "@/db/empresa-context";
import { optimizacionCompetidoresExt } from "@/db/schema";
import { validarCompetidores, type CompetidorExtension } from "./competidoresExtension";

export type CompetidoresGuardados = { termino: string; candidatos: number; competidores: CompetidorExtension[]; leidoTs: string };

export async function leerCompetidoresGuardados(empresaId: string, itemId: string): Promise<CompetidoresGuardados | null> {
  const [fila] = await dbComoEmpresa(empresaId, (tx) =>
    tx
      .select({ termino: optimizacionCompetidoresExt.termino, candidatos: optimizacionCompetidoresExt.candidatos, competidores: optimizacionCompetidoresExt.competidores, leidoTs: optimizacionCompetidoresExt.leidoTs })
      .from(optimizacionCompetidoresExt)
      .where(and(eq(optimizacionCompetidoresExt.empresaId, empresaId), eq(optimizacionCompetidoresExt.itemId, itemId)))
      .limit(1)
  );
  if (!fila) return null;
  // Lo guardado se revalida al leerlo, igual que al escribirlo.
  const valido = validarCompetidores({ itemId, termino: fila.termino, candidatos: fila.candidatos, competidores: fila.competidores });
  return valido ? { ...valido, leidoTs: fila.leidoTs.toISOString() } : null;
}

export async function guardarCompetidores(
  empresaId: string,
  datos: { usuarioId: string; cuentaMlId: string; itemId: string; termino: string; candidatos: number; competidores: CompetidorExtension[] }
): Promise<string> {
  const ahora = new Date();
  await dbComoEmpresa(empresaId, (tx) =>
    tx
      .insert(optimizacionCompetidoresExt)
      .values({ empresaId, cuentaMlId: datos.cuentaMlId, itemId: datos.itemId, termino: datos.termino, candidatos: datos.candidatos, competidores: datos.competidores, leidoTs: ahora, usuarioId: datos.usuarioId })
      .onConflictDoUpdate({
        target: [optimizacionCompetidoresExt.empresaId, optimizacionCompetidoresExt.itemId],
        set: { cuentaMlId: datos.cuentaMlId, termino: datos.termino, candidatos: datos.candidatos, competidores: datos.competidores, leidoTs: ahora, usuarioId: datos.usuarioId },
      })
  );
  return ahora.toISOString();
}
