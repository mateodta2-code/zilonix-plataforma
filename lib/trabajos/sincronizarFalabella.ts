// Issue #422 — importación automática de pedidos Falabella, cada 30 min
// (.github/workflows/sincronizar-falabella.yml). Mismo modelo que
// Publicidad (issue #254):
//
// - El cron enumera cuentas con falabella_trabajador_user, que solo ve
//   id, empresa_id y desconectada_ts. Nunca la API Key.
// - importarPedidos (lib/falabella/pedidos.ts) descifra las credenciales
//   y guarda por dbComoEmpresa, ya con la empresa conocida.
// - Una cuenta que falla no corta a las demás: queda en auditoria como
//   "sistema" y el cron sigue con la siguiente.
// - El resumen que devuelve no lleva datos sensibles: id de cuenta,
//   conteos y el nombre del error, nunca el mensaje crudo.

import { asc, isNull } from "drizzle-orm";
import { dbTrabajadorFalabella } from "@/db/trabajador-falabella-context";
import { dbComoEmpresa } from "@/db/empresa-context";
import { cuentasFalabella } from "@/db/schema";
import { registrarAuditoria } from "@/lib/auditoria";
import { importarPedidos } from "@/lib/falabella/pedidos";

export const DIAS_HACIA_ATRAS = 3;
const MS_POR_DIA = 24 * 60 * 60 * 1000;

export type ResultadoCuentaFalabella =
  | { cuentaId: string; ok: true; importados: number; truncado: boolean }
  | { cuentaId: string; ok: false; error: string };

export type ResumenSincronizacionFalabella = {
  desde: string;
  revisadas: number;
  correctas: number;
  fallidas: number;
  cuentas: ResultadoCuentaFalabella[];
};

// Para la auditoría: frase corta, sin URLs (la firma viaja en la query
// de Falabella) ni correos (el UserID de Falabella es un correo).
export function errorSeguro(error: unknown): string {
  const nombre = error instanceof Error ? error.name : "Error";
  const mensaje = error instanceof Error ? error.message : "";
  return `${nombre}: ${mensaje}`
    .replace(/https?:\/\/\S+/gi, "[url omitida]")
    .replace(/[^\s@]+@[^\s@]+\.[^\s@]+/g, "[correo omitido]")
    .replace(/(Signature|ApiKey|api_key)\s*[:=]\s*\S+/gi, "$1=[omitido]")
    .slice(0, 180);
}

export async function sincronizarFalabellaProgramada(ahora: Date = new Date()): Promise<ResumenSincronizacionFalabella> {
  const desde = new Date(ahora.getTime() - DIAS_HACIA_ATRAS * MS_POR_DIA);

  const cuentas = await dbTrabajadorFalabella
    .select({ id: cuentasFalabella.id, empresaId: cuentasFalabella.empresaId })
    .from(cuentasFalabella)
    .where(isNull(cuentasFalabella.desconectadaTs))
    .orderBy(asc(cuentasFalabella.id));

  const resultados: ResultadoCuentaFalabella[] = [];
  for (const cuenta of cuentas) {
    try {
      const { importados, truncado } = await importarPedidos(cuenta.empresaId, cuenta.id, desde);
      resultados.push({ cuentaId: cuenta.id, ok: true, importados, truncado });
    } catch (error) {
      const detalle = errorSeguro(error);
      console.error(`[trabajos/falabella] la cuenta ${cuenta.id} falló: ${detalle}`);
      resultados.push({ cuentaId: cuenta.id, ok: false, error: error instanceof Error ? error.name : "Error" });
      try {
        await dbComoEmpresa(cuenta.empresaId, (tx) =>
          registrarAuditoria(tx, {
            empresaId: cuenta.empresaId,
            usuarioId: null,
            actorTipo: "sistema",
            accion: "sincronizar_pedidos_falabella_fallida",
            entidad: "cuentas_falabella",
            entidadId: cuenta.id,
            detalle: `La importación automática de pedidos falló. ${detalle}`,
          })
        );
      } catch (errorAuditoria) {
        console.error(`[trabajos/falabella] no se pudo auditar la falla de ${cuenta.id}: ${errorSeguro(errorAuditoria)}`);
      }
    }
  }

  const correctas = resultados.filter((r) => r.ok).length;
  return {
    desde: desde.toISOString(),
    revisadas: resultados.length,
    correctas,
    fallidas: resultados.length - correctas,
    cuentas: resultados,
  };
}
