// Issue #251 ("Seguimiento muestra aproximados como Selltrix") —
// ayuda de calibración para FACTOR_VENDIDOS_FULL/FACTOR_VENDIDOS_SIN_FULL
// (lib/seguimiento/aproximados.ts, hoy 2.2/1.55, valores de referencia
// de Selltrix) — nunca los toca, solo imprime un reporte para que una
// persona decida si ajustarlos.
//
// SOLO LECTURA, SIN ESCRITURAS, SIN LLAMADAS A MERCADO LIBRE (regla
// explícita de esta tarea: "no uses ni refresques tokens de vendedor
// de ML") — todo sale de lo que seguimiento_fotos YA guardó. Esto
// descarta a propósito la comparación "literal" (sold_quantity real
// vs. el '+N' redondeado que Mercado Libre muestra en pantalla): ese
// redondeo es un comportamiento de la PÁGINA, nunca de la API, y
// confirmarlo de verdad necesitaría la extensión leyendo una ficha en
// vivo (fuera del alcance de un script de servidor) — y el algoritmo
// de redondeo real de Mercado Libre nunca se confirmó contra
// evidencia real en este repo (CLAUDE.md: "nunca se adivina el
// comportamiento de la API de Mercado Libre"), así que este script no
// lo inventa.
//
// En su lugar, compara dos RITMOS REALES (nunca estimados) de la MISMA
// publicación PROPIA (esCompetidor=false — ahí sold_quantity siempre
// es exacto, nunca el piso "+N"): el ritmo promedio de TODA la
// historia que ya tenemos guardada, contra el ritmo de los últimos 30
// días. La premisa real detrás de FACTOR_VENDIDOS_FULL/SIN_FULL es
// "una publicación Full/de alto volumen vende HOY más rápido de lo que
// su acumulado crudo sugeriría" — esta "aceleración reciente vs.
// promedio histórico" es la señal más cercana que se puede medir sin
// tocar Mercado Libre, agrupada por esFull para ver si el real
// confirma (o no) que Full acelera más que no-Full, y si la magnitud
// anda cerca de 2.2/1.55.
//
// LIMITACIÓN, dicha en voz alta: esto NO reproduce el "+N" redondeado
// que ve un competidor — mide algo relacionado (aceleración reciente)
// pero no idéntico. Léase como una señal DIRECCIONAL (¿2.2/1.55 están
// groseramente mal, o más o menos en rango?), nunca como un valor para
// pegar directo en el código sin juicio humano.
//
//   npx tsx scripts/calibrar-factor-vendidos.ts                 # todas las empresas
//   npx tsx scripts/calibrar-factor-vendidos.ts --empresa=<id>  # solo esa empresa

import { eq, and, isNull } from "drizzle-orm";
import { dbTrabajadorSeguimiento } from "@/db/trabajador-seguimiento-context";
import { dbComoEmpresa } from "@/db/empresa-context";
import { seguimientosMl, seguimientoFotos } from "@/db/schema";
import { ventasDelPeriodo } from "@/lib/seguimiento/ventas";
import { ventasMes, FACTOR_VENDIDOS_FULL, FACTOR_VENDIDOS_SIN_FULL } from "@/lib/seguimiento/aproximados";

const VENTANA_RECIENTE_DIAS = 30;
const MS_POR_DIA = 24 * 60 * 60 * 1000;

function diasEntre(a: Date, b: Date): number {
  return Math.abs(a.getTime() - b.getTime()) / MS_POR_DIA;
}

function empresaDeArgv(): string | null {
  const arg = process.argv.find((a) => a.startsWith("--empresa="));
  return arg ? arg.slice("--empresa=".length) : null;
}

type Muestra = { seguimientoId: string; mlIdExterno: string; esFull: boolean; aceleracion: number };

async function main() {
  const empresaId = empresaDeArgv();

  const filtro = empresaId
    ? and(
        eq(seguimientosMl.tipo, "producto"),
        eq(seguimientosMl.recursoMl, "item"),
        eq(seguimientosMl.esCompetidor, false),
        isNull(seguimientosMl.eliminadoTs),
        eq(seguimientosMl.empresaId, empresaId)
      )
    : and(eq(seguimientosMl.tipo, "producto"), eq(seguimientosMl.recursoMl, "item"), eq(seguimientosMl.esCompetidor, false), isNull(seguimientosMl.eliminadoTs));

  const candidatos = await dbTrabajadorSeguimiento.select().from(seguimientosMl).where(filtro);
  console.log(
    `${candidatos.length} seguimiento(s) PROPIO(s) de tipo producto/item activos${empresaId ? ` (empresa ${empresaId})` : ""} — leyendo su historial de fotos (sin llamar a Mercado Libre)...`
  );

  const muestras: Muestra[] = [];
  let sinHistorialSuficiente = 0;
  let sinVentanaReciente = 0;

  for (const seguimiento of candidatos) {
    const fotos = await dbComoEmpresa(seguimiento.empresaId, (tx) =>
      tx.select().from(seguimientoFotos).where(eq(seguimientoFotos.seguimientoId, seguimiento.id)).orderBy(seguimientoFotos.fecha)
    );
    const conDato = fotos.filter((f) => f.vendidos != null && f.esFull != null);
    if (conDato.length < 2) {
      sinHistorialSuficiente += 1;
      continue;
    }

    const primera = conDato[0];
    const ultima = conDato[conDato.length - 1];
    const diasTotales = diasEntre(primera.fecha, ultima.fecha);
    if (diasTotales < 1) {
      sinHistorialSuficiente += 1;
      continue;
    }

    const ventasTotales = ventasDelPeriodo(ultima.vendidos, primera.vendidos);
    const ritmoHistorico = ventasMes(ventasTotales, diasTotales);
    if (ritmoHistorico == null || ritmoHistorico <= 0) {
      sinHistorialSuficiente += 1;
      continue;
    }

    const limiteReciente = new Date(ultima.fecha.getTime() - VENTANA_RECIENTE_DIAS * MS_POR_DIA);
    const enVentanaReciente = conDato.filter((f) => f.fecha >= limiteReciente);
    if (enVentanaReciente.length < 2) {
      sinVentanaReciente += 1;
      continue;
    }
    const primeraReciente = enVentanaReciente[0];
    const diasRecientes = diasEntre(primeraReciente.fecha, ultima.fecha);
    if (diasRecientes < 1) {
      sinVentanaReciente += 1;
      continue;
    }
    const ventasRecientes = ventasDelPeriodo(ultima.vendidos, primeraReciente.vendidos);
    const ritmoReciente = ventasMes(ventasRecientes, diasRecientes);
    if (ritmoReciente == null) {
      sinVentanaReciente += 1;
      continue;
    }

    muestras.push({
      seguimientoId: seguimiento.id,
      mlIdExterno: seguimiento.mlIdExterno,
      esFull: ultima.esFull === true,
      aceleracion: ritmoReciente / ritmoHistorico,
    });
  }

  function reportarGrupo(nombre: string, factorActual: number) {
    const delGrupo = muestras.filter((m) => m.esFull === (nombre === "Full"));
    if (delGrupo.length === 0) {
      console.log(`\n${nombre}: sin muestras comparables todavía.`);
      return;
    }
    const promedio = delGrupo.reduce((suma, m) => suma + m.aceleracion, 0) / delGrupo.length;
    const ordenado = [...delGrupo].sort((a, b) => a.aceleracion - b.aceleracion);
    const mediana = ordenado[Math.floor(ordenado.length / 2)].aceleracion;
    console.log(
      `\n${nombre} (${delGrupo.length} publicación(es) propias con historial suficiente):\n` +
        `  aceleración reciente/histórica — promedio ${promedio.toFixed(2)}×, mediana ${mediana.toFixed(2)}×\n` +
        `  factor actual en el código: ${factorActual}×\n` +
        `  ${Math.abs(promedio - factorActual) < 0.3 ? "en rango razonable del factor actual." : "se aleja bastante del factor actual — revisar a mano si tiene sentido ajustarlo."}`
    );
  }

  console.log(`\n${muestras.length} publicación(es) propia(s) con ritmo histórico Y reciente medibles (de ${candidatos.length} seguimiento(s) propios activos).`);
  reportarGrupo("Full", FACTOR_VENDIDOS_FULL);
  reportarGrupo("no Full", FACTOR_VENDIDOS_SIN_FULL);

  console.log(
    `\n${sinHistorialSuficiente} sin al menos 2 fotos con vendidos/esFull (o sin 1+ día de diferencia entre la primera y la última), ` +
      `${sinVentanaReciente} con historial largo pero sin 2+ fotos dentro de los últimos ${VENTANA_RECIENTE_DIAS} días.\n` +
      `Recordatorio: esto mide aceleración reciente vs. histórica, NO el "+N" redondeado real — es una señal direccional, nunca un valor para pegar directo sin juicio humano.`
  );

  process.exit(0);
}

main();
