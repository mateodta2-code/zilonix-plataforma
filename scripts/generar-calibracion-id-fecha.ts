// Issue #262 ("Aproximados estilo Selltrix en los 3 lugares") — causa
// de fondo: `lib/seguimiento/calibracion-aproximados.json` tiene
// `puntos: []` — sin NINGÚN punto calibrado, `antiguedadDias()` nunca
// puede interpolar nada (ni siquiera lo intenta con menos de 2 del
// mismo país+tipo), así que "por mes" sale vacío en Seguimiento,
// Investigación/Demanda y el popup de la extensión por igual, sin
// importar qué tan bien estén las fórmulas.
//
// SOLO LECTURA, SIN ESCRITURAS, SIN LLAMADAS A MERCADO LIBRE (misma
// regla que scripts/calibrar-factor-vendidos.ts) — saca pares REALES
// (id de Mercado Libre + fecha de creación real) de datos que YA
// están en nuestra base, de 2 fuentes:
//
//   1. `seguimiento_fotos.publicaciones.fechaCreacion` — competidores
//      (tipo="producto") cuyo date_created la API YA confirmó alguna
//      vez (el cron lo guarda desde el PR #261,
//      lib/trabajos/revisionDiariaSeguimiento.ts — antes de ese PR
//      esto nunca se guardaba, por eso la tabla sigue vacía hoy).
//   2. `productos_ml.resultado[].itemId` (publicación ÉXITO) +
//      `productos_ml.publicado_ts` — publicaciones PROPIAS: el
//      instante en que Zilonix mismo disparó la publicación es, en la
//      práctica, el MISMO instante que el date_created real de
//      Mercado Libre para ese item (la API lo crea ahí mismo, al
//      recibir el POST) — sirve como par real sin necesitar guardar
//      date_created aparte.
//
// (La idea original de este punto mencionaba "date_created de
// publicaciones propias si los guardamos" — revisado: la tabla
// `publicaciones`, lo que YA importamos de cuentas conectadas, NO
// guarda ningún date_created real, solo `importado_ts` — cuándo
// ZILONIX lo importó, nunca cuándo Mercado Libre lo creó. Esa fuente
// no sirve; la fuente 2 de arriba, sí.)
//
// Cross-empresa sin ningún grant nuevo: `dbTrabajadorSeguimiento`
// (rol ya existente) para enumerar seguimientos de cualquier empresa
// (fuente 1, mismo patrón que scripts/calibrar-factor-vendidos.ts);
// `dbSuperadmin` (rol ya existente, SOLO lee `empresas.id` — ninguna
// columna de negocio) para enumerar TODAS las empresas y poder barrer
// `productos_ml` de cada una por `dbComoEmpresa`/`app_user` (fuente
// 2) — nadie necesita un grant nuevo sobre `productos_ml` para esto,
// cada lectura de detalle sigue pasando por RLS normal.
//
// Separados por país (prefijo real del id) y por tipo (item/product)
// — imprime el JSON listo para pegar en "puntos" de
// lib/seguimiento/calibracion-aproximados.json. Lo corre una persona a
// mano; nunca se aplica solo.
//
//   npx tsx scripts/generar-calibracion-id-fecha.ts

import { and, eq, isNotNull, isNull } from "drizzle-orm";
import { dbComoEmpresa } from "@/db/empresa-context";
import { dbSuperadmin } from "@/db/superadmin-context";
import { dbTrabajadorSeguimiento } from "@/db/trabajador-seguimiento-context";
import { empresas, productosMl, seguimientoFotos, seguimientosMl } from "@/db/schema";
import { decidirPuntoCompetidor, esResultadoExito, prefijoDeId, puntoDePropia, type Punto } from "./generar-calibracion-id-fecha-logica";

// Fuente 1 — competidores con date_created ya confirmado por la API.
// decidirPuntoCompetidor (generar-calibracion-id-fecha-logica.ts) es
// la decisión real (issue #262, punto BLOQUEANTE: nunca la fecha de
// un ítem ganador para un catálogo) — ver ese archivo.
async function puntosDeCompetidores(): Promise<{ puntos: Punto[]; omitidos: number }> {
  const seguimientos = await dbTrabajadorSeguimiento
    .select()
    .from(seguimientosMl)
    .where(and(eq(seguimientosMl.tipo, "producto"), isNull(seguimientosMl.eliminadoTs)));

  const puntos: Punto[] = [];
  let omitidos = 0;
  for (const s of seguimientos) {
    // "seller" nunca aplica acá (tipo ya filtrado a "producto" arriba,
    // nunca puede ser "seller") — el chequeo es solo para que TS sepa
    // que de acá en más recursoMl es "item" | "product".
    if (s.recursoMl !== "item" && s.recursoMl !== "product") continue;
    const fotos = await dbComoEmpresa(s.empresaId, (tx) => tx.select().from(seguimientoFotos).where(eq(seguimientoFotos.seguimientoId, s.id)));
    const { punto, omitido } = decidirPuntoCompetidor(s.mlIdExterno, s.recursoMl, fotos);
    if (punto) puntos.push(punto);
    if (omitido) omitidos += 1;
  }
  return { puntos, omitidos };
}

// Fuente 2 — publicaciones propias recién publicadas (resultado[].itemId
// + publicado_ts, nunca date_created guardado aparte — no existe).
async function puntosDePropias(): Promise<Punto[]> {
  const todasLasEmpresas = await dbSuperadmin.select({ id: empresas.id }).from(empresas);

  const puntos: Punto[] = [];
  for (const { id: empresaId } of todasLasEmpresas) {
    const productos = await dbComoEmpresa(empresaId, (tx) => tx.select().from(productosMl).where(isNotNull(productosMl.resultado)));
    for (const p of productos) {
      if (!Array.isArray(p.resultado)) continue;
      for (const r of p.resultado) {
        if (!esResultadoExito(r)) continue;
        const punto = puntoDePropia(r.itemId, p.publicadoTs);
        if (punto) puntos.push(punto);
      }
    }
  }
  return puntos;
}

async function main() {
  console.log("Leyendo seguimiento_fotos (competidores con date_created confirmado por la API)...");
  const { puntos: deCompetidores, omitidos } = await puntosDeCompetidores();
  console.log(`  ${deCompetidores.length} punto(s) real(es) encontrados.`);
  if (omitidos > 0) {
    console.log(
      `  ${omitidos} seguimiento(s) de catálogo (recurso_ml "product") omitido(s): fecha de ítem ganador, no de catálogo — ` +
        `sin fechaCreacionCatalogo confirmada todavía, nunca se usa la del ítem ganador en su lugar.`
    );
  }

  console.log("Leyendo productos_ml (publicaciones propias, resultado[].itemId + publicado_ts)...");
  const dePropias = await puntosDePropias();
  console.log(`  ${dePropias.length} punto(s) real(es) encontrados.`);

  const todos = [...deCompetidores, ...dePropias];
  // Dedup por id — si el mismo id aparece por las dos fuentes (raro,
  // pero posible si una empresa sigue su propio producto como
  // competidor de otra cuenta), se queda con el primero (competidores),
  // nunca con los dos.
  const vistos = new Set<string>();
  const sinDuplicados = todos.filter((p) => {
    if (vistos.has(p.id)) return false;
    vistos.add(p.id);
    return true;
  });

  console.log(`\n${sinDuplicados.length} punto(s) real(es) en total (sin duplicados).`);

  const porPaisYTipo = new Map<string, Punto[]>();
  for (const p of sinDuplicados) {
    const prefijo = prefijoDeId(p.id);
    if (!prefijo) continue;
    const clave = `${prefijo} (${p.tipo})`;
    if (!porPaisYTipo.has(clave)) porPaisYTipo.set(clave, []);
    porPaisYTipo.get(clave)!.push(p);
  }

  console.log("\nPuntos por país y tipo:");
  if (porPaisYTipo.size === 0) {
    console.log("  ninguno todavía.");
  }
  for (const [clave, puntos] of porPaisYTipo) {
    console.log(`  ${clave}: ${puntos.length} punto(s)${puntos.length < 4 ? " — probablemente insuficiente todavía, ver la nota de abajo" : ""}`);
  }

  console.log('\nJSON para pegar en "puntos" (lib/seguimiento/calibracion-aproximados.json):\n');
  console.log(JSON.stringify(sinDuplicados, null, 2));

  console.log(
    "\nCuántos puntos hacen falta — con 2 del mismo país+tipo, antiguedadDiasPorId() YA puede interpolar (es el mínimo técnico para que la cuenta " +
      "ni siquiera dé null), pero con tan pocos, cualquier id fuera del rango calibrado EXTRAPOLA con la pendiente de esos 2 solos — un punto raro " +
      "(una promoción vieja, un error de fecha) tuerce la pendiente para TODOS los demás ids de ese país+tipo, sin ningún otro punto que lo " +
      "contrapese. Para que la interpolación sea RAZONABLE (no solo posible): al menos 4-6 puntos por país+tipo, repartidos en el tiempo (no todos " +
      "de la misma semana/promoción) — eso ya deja ver si la relación id→fecha es razonablemente lineal en ese rango, y un punto fuera de lugar " +
      "pesa menos sobre el resto. 8-10 puntos, bien repartidos, sería más robusto todavía (sobre todo para extrapolar ids MÁS NUEVOS que el punto " +
      "calibrado más alto, el caso más común en la práctica: casi toda publicación de un competidor es más nueva que lo último que publicamos " +
      "nosotros mismos). Para catálogo (/p/MCO…, tipo \"product\"): mientras no haya esos mismos 4-6 puntos reales de tipo \"product\" (no alcanza " +
      "con los de \"item\", son numeraciones independientes — ver el comentario de PUNTOS_CALIBRACION_ID_FECHA, lib/seguimiento/aproximados.ts), la " +
      "antigüedad de un catálogo sigue mostrando \"Sin dato\" — nunca se inventa interpolando contra puntos de un tipo distinto."
  );

  process.exit(0);
}

main();
