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
// Postgres para esto.
//
// Corrección de Pablo (revisión del PR #253) — confirmarRecursoProductoMl
// NUNCA recibe un token: es solo una verificación pública de
// existencia (/items y /products), nunca hace falta ver datos
// privados de una cuenta por esto, y pasar un token acá arriesgaba
// consumir un refresh token de un solo uso de la app de Mercado Libre
// COMPARTIDA entre staging y producción por una simple corrección de
// datos. Este script, a propósito, ya NO resuelve cuenta/token de
// ninguna empresa.
//
//   npx tsx scripts/corregir-tipo-recurso-seguimiento.ts                       # dry-run, todas las empresas
//   npx tsx scripts/corregir-tipo-recurso-seguimiento.ts --aplicar             # corrige de verdad
//   npx tsx scripts/corregir-tipo-recurso-seguimiento.ts --empresa=<id>        # solo esa empresa (dry-run)
//   npx tsx scripts/corregir-tipo-recurso-seguimiento.ts --empresa=<id> --aplicar

import { and, eq, isNull } from "drizzle-orm";
import { dbTrabajadorSeguimiento } from "@/db/trabajador-seguimiento-context";
import { seguimientosMl } from "@/db/schema";
import { confirmarRecursoProductoMl } from "@/lib/ml/cliente";

// "Respeta los límites de ML: pausa entre llamadas" — mismo criterio
// que lib/trabajos/revisionDiariaSeguimiento.ts (PAUSA_ENTRE_SEGUIMIENTOS_MS).
const PAUSA_ENTRE_LLAMADAS_MS = 500;

function esperar(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function empresaDeArgv(): string | null {
  const arg = process.argv.find((a) => a.startsWith("--empresa="));
  return arg ? arg.slice("--empresa=".length) : null;
}

async function main() {
  const aplicar = process.argv.includes("--aplicar");
  const empresaId = empresaDeArgv();

  const filtro = empresaId
    ? and(eq(seguimientosMl.tipo, "producto"), eq(seguimientosMl.recursoMl, "item"), isNull(seguimientosMl.eliminadoTs), eq(seguimientosMl.empresaId, empresaId))
    : and(eq(seguimientosMl.tipo, "producto"), eq(seguimientosMl.recursoMl, "item"), isNull(seguimientosMl.eliminadoTs));

  const candidatos = await dbTrabajadorSeguimiento.select().from(seguimientosMl).where(filtro);

  console.log(
    `${candidatos.length} seguimiento(s) de tipo producto/item activos${empresaId ? ` (empresa ${empresaId})` : ""} — confirmando contra Mercado Libre (sin token)...`
  );

  let corregidos = 0;
  let sinCambio = 0;
  let noEncontrados = 0;
  let sinConfirmar = 0;

  for (let i = 0; i < candidatos.length; i++) {
    if (i > 0) await esperar(PAUSA_ENTRE_LLAMADAS_MS);
    const seguimiento = candidatos[i];
    try {
      const confirmacion = await confirmarRecursoProductoMl(seguimiento.mlIdExterno);

      if (confirmacion.estado === "confirmado" && confirmacion.recursoMl === "product") {
        console.log(`  ${seguimiento.id} (${seguimiento.mlIdExterno}) — confirmado como "product", ${aplicar ? "corrigiendo" : "se corregiría"}.`);
        if (aplicar) {
          await dbTrabajadorSeguimiento.update(seguimientosMl).set({ recursoMl: "product" }).where(eq(seguimientosMl.id, seguimiento.id));
        }
        corregidos += 1;
      } else if (confirmacion.estado === "confirmado") {
        sinCambio += 1; // confirmado como "item" real, nada que corregir
      } else if (confirmacion.estado === "no_encontrado") {
        console.log(`  ${seguimiento.id} (${seguimiento.mlIdExterno}) — ni /items ni /products lo encuentran (404 real) — revisar a mano, el script nunca borra.`);
        noEncontrados += 1;
      } else {
        console.log(`  ${seguimiento.id} (${seguimiento.mlIdExterno}) — no se pudo confirmar contra Mercado Libre ahora (403/5xx), se saltea.`);
        sinConfirmar += 1;
      }
    } catch (error) {
      console.error(`  ${seguimiento.id} — error al confirmar:`, error instanceof Error ? error.message : error);
      sinConfirmar += 1;
    }
  }

  console.log(
    `Listo. ${corregidos} corregido(s)${aplicar ? "" : " (dry-run, nada se guardó todavía — correr con --aplicar)"}, ${sinCambio} ya eran "item" real, ` +
      `${noEncontrados} sin encontrar en ML (revisar a mano), ${sinConfirmar} sin confirmar (se pueden reintentar corriendo el script otra vez).`
  );

  process.exit(0);
}

main();
