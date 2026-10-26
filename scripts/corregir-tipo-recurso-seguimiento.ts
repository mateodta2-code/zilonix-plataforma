// Issue #250, punto A — corrección única para seguimientos de tipo
// "producto" que ya quedaron guardados con recurso_ml="item" por
// error, ANTES de que agregarSeguimiento confirmara el tipo real
// contra Mercado Libre (lib/seguimiento/seguimientos.ts): un id de
// catálogo pegado sin "/p/" en el link se guardaba como "item" sin
// confirmar nada — /items/{id} da 404 para siempre con ese id, la
// fila queda atascada en "Pendiente de primera revisión".
//
// Solo CORRIGE recurso_ml ("item" -> "product") cuando Mercado Libre
// confirma que de verdad es un producto de catálogo (mismo
// confirmarRecursoProductoMl que ya usa el alta nueva) — nunca
// inserta, nunca borra, nunca toca tipo="tienda"/recurso_ml="seller".
//
// dbTrabajadorSeguimiento (mismo rol restringido, SELECT/UPDATE solo
// en seguimientos_ml, que ya usa lib/trabajos/revisionDiariaSeguimiento.ts)
// para enumerar cruzando TODAS las empresas — nunca el superusuario de
// Postgres para esto. El token de cada empresa sale de
// obtenerAccessTokenVigente (lib/ml/cuentas.ts), mismo camino que la
// revisión diaria — nunca un token usado o refrescado a mano.
//
//   npx tsx scripts/corregir-tipo-recurso-seguimiento.ts            # dry-run, solo reporta
//   npx tsx scripts/corregir-tipo-recurso-seguimiento.ts --aplicar  # corrige de verdad

import { and, eq, isNull } from "drizzle-orm";
import { dbTrabajadorSeguimiento } from "@/db/trabajador-seguimiento-context";
import { seguimientosMl } from "@/db/schema";
import { obtenerAccessTokenVigente, obtenerCuentaMlActiva } from "@/lib/ml/cuentas";
import { confirmarRecursoProductoMl } from "@/lib/ml/cliente";

// "Respeta los límites de ML: pausa entre llamadas" — mismo criterio
// que lib/trabajos/revisionDiariaSeguimiento.ts (PAUSA_ENTRE_SEGUIMIENTOS_MS).
const PAUSA_ENTRE_LLAMADAS_MS = 500;

function esperar(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main() {
  const aplicar = process.argv.includes("--aplicar");

  const candidatos = await dbTrabajadorSeguimiento
    .select()
    .from(seguimientosMl)
    .where(and(eq(seguimientosMl.tipo, "producto"), eq(seguimientosMl.recursoMl, "item"), isNull(seguimientosMl.eliminadoTs)));

  console.log(`${candidatos.length} seguimiento(s) de tipo producto/item activos — confirmando contra Mercado Libre...`);

  let corregidos = 0;
  let sinCambio = 0;
  let sinConfirmar = 0;

  for (let i = 0; i < candidatos.length; i++) {
    if (i > 0) await esperar(PAUSA_ENTRE_LLAMADAS_MS);
    const seguimiento = candidatos[i];
    try {
      const cuenta = await obtenerCuentaMlActiva(seguimiento.empresaId);
      if (!cuenta) {
        console.log(`  ${seguimiento.id} (${seguimiento.mlIdExterno}) — empresa sin cuenta ML conectada, se saltea.`);
        sinConfirmar += 1;
        continue;
      }
      const token = await obtenerAccessTokenVigente(seguimiento.empresaId, cuenta.id);
      const confirmado = await confirmarRecursoProductoMl(seguimiento.mlIdExterno, token);

      if (confirmado === "product") {
        console.log(`  ${seguimiento.id} (${seguimiento.mlIdExterno}) — confirmado como "product", ${aplicar ? "corrigiendo" : "se corregiría"}.`);
        if (aplicar) {
          await dbTrabajadorSeguimiento.update(seguimientosMl).set({ recursoMl: "product" }).where(eq(seguimientosMl.id, seguimiento.id));
        }
        corregidos += 1;
      } else if (confirmado === "item") {
        sinCambio += 1;
      } else {
        console.log(`  ${seguimiento.id} (${seguimiento.mlIdExterno}) — no se pudo confirmar contra Mercado Libre ahora, se saltea.`);
        sinConfirmar += 1;
      }
    } catch (error) {
      console.error(`  ${seguimiento.id} — error al confirmar:`, error instanceof Error ? error.message : error);
      sinConfirmar += 1;
    }
  }

  console.log(
    `Listo. ${corregidos} corregido(s)${aplicar ? "" : " (dry-run, nada se guardó todavía — correr con --aplicar)"}, ${sinCambio} ya eran "item" real, ${sinConfirmar} sin confirmar (se pueden reintentar corriendo el script otra vez).`
  );
}

main();
