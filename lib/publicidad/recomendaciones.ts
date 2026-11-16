// Issue #255 — textos de recomendación. No hay botón ni llamada a
// Mercado Libre: la pantalla solo los muestra; todo cambio lo aprueba y
// lo hace el comercio. Nunca se sugiere subir el presupuesto ni el
// gasto total, mover presupuesto entre campañas ni bajar el objetivo de
// ROAS para gastar más.
//
// Semáforo de campaña (16-nov): gris aprendiendo = no se propone nada;
// verde (ROAS en el objetivo o más) = se deja igual; amarillo (70 % a
// 100 %) = vigilar, y puede sugerir sacar anuncios que gastan sin
// vender; rojo (bajo el 70 %) = apagar y crear una nueva.
// Enfriamiento es solo para anuncios que gastan sin vender. El que
// vende bien se queda en la campaña donde ya funciona.
//
// Reglas del negocio (14-nov). Solo hay tres tipos de campaña:
// - ENFRIAMIENTO y ANTÁRTIDA: una sola de cada una, con ese nombre
//   exacto. Si hay dos con el mismo nombre, se avisa.
// - VENDEDOR: puede haber varias; cuenta toda campaña cuyo nombre
//   EMPIEZA por VENDEDOR. Una campaña con cualquier otro nombre también
//   es VENDEDOR: se sugiere renombrarla y se le aplican esas reglas.
// El camino de un producto: entra a ENFRIAMIENTO; si vende, la campaña
// pasa a VENDEDOR; si deja de vender, vuelve a ENFRIAMIENTO; el que no
// vende en ENFRIAMIENTO va a ANTÁRTIDA.
// - ENFRIAMIENTO con algún anuncio que vende: la campaña se renombra a
//   VENDEDOR y se quitan solo los que no venden y PASAN el tope de
//   consumo. Los que consumen poquito se pueden dejar.
// - ENFRIAMIENTO sin ninguna venta: los que gastan sin vender pasan a
//   ANTÁRTIDA (o se crea).
// - ANTÁRTIDA: el que vende se queda. El que no vende y pasa el tope se
//   pausa o se saca 7 días y después vuelve a ANTÁRTIDA.
// - VENDEDOR: el que lleva 7 días sin vender (gastó en esos días, hasta
//   ayer) o pasó el ACOS máximo (20 %, el del semáforo) vuelve a
//   ENFRIAMIENTO (o se sugiere crearla).
// El tope de consumo es el del semáforo del anuncio (gasto sin ventas
// sobre el 5 % del precio, TOPE_GASTO_SIN_VENTAS). Sin precio no se
// sabe: no se sugiere quitar ni pausar.

import { mostrarDineroCompacto, mostrarRoas } from "@/lib/publicidad/formato";
import {
  ACOS_MAXIMO,
  CAMPANA_ANTARTIDA,
  CAMPANA_ENFRIAMIENTO,
  CAMPANA_VENDEDOR,
  DIAS_PAUSA_ANTARTIDA,
  DIAS_SIN_VENDER_VENDEDOR,
  FACTOR_ROAS_VENDE_BIEN,
  UMBRAL_EN_OBJETIVO,
  UMBRAL_ROAS_BAJO,
} from "@/lib/publicidad/config";
import { gastaSinVender, roasFrenteA, tieneVentaAtribuida } from "@/lib/publicidad/kpis";

export type CodigoRecomendacion =
  | "aprendizaje"
  | "apagar"
  | "dejar_igual"
  | "vigilar"
  | "pasar_enfriamiento"
  | "crear_enfriamiento"
  | "mover_antartida"
  | "crear_antartida"
  | "renombrar_vendedor"
  | "campana_repetida"
  | "quitar_de_campana"
  | "pausar_antartida"
  | "nota_vende_bien"
  | "nota_vende_antartida";

// Notas, no acciones: la pantalla las pinta en tono neutro.
export const CODIGOS_NOTA: readonly CodigoRecomendacion[] = [
  "aprendizaje",
  "dejar_igual",
  "vigilar",
  "nota_vende_bien",
  "nota_vende_antartida",
];

export type Recomendacion = {
  codigo: CodigoRecomendacion;
  anuncioId: string | null;
  nombre: string | null;
  texto: string;
  motivo: string;
};

export type AnuncioRecomendable = {
  id: string;
  titulo: string | null;
  itemId: string;
  gasto: string | null;
  ingresos: string | null;
  ventasCantidad: string | null;
  roas: string | null;
  // Semáforo del anuncio por gasto sin ventas: true si pasa el tope
  // (5 % del precio), false si está dentro, null si no se sabe (sin
  // precio, o el anuncio vende y se juzga por ACOS).
  pasaTopeConsumo: boolean | null;
  topeConsumo: string | null;
  // Semáforo por ACOS (el anuncio vende): el ACOS real si pasa el
  // máximo, null si está dentro o no se juzga por ACOS.
  acosSobreMaximo: string | null;
  // Últimos DIAS_SIN_VENDER_VENDEDOR días completos, hasta ayer.
  gastoUltimosDias: string | null;
  vendioUltimosDias: boolean;
};

const TEXTO_APRENDIZAJE = "En aprendizaje, no tocar todavía";
const TEXTO_APAGAR = "Apagar y crear una nueva";
const TEXTO_DEJAR_IGUAL = "Se deja igual";
const TEXTO_VIGILAR = "Vigilar";
const TEXTO_VENDE_BIEN = "Vende bien, dejar en esta campaña";
const TEXTO_RENOMBRAR = `Cambiar el nombre de la campaña a ${CAMPANA_VENDEDOR}`;
const TEXTO_QUITAR = "Quitar de la campaña";
const TEXTO_PAUSAR_ANTARTIDA = `Pausar o sacar de la campaña ${DIAS_PAUSA_ANTARTIDA} días; después, volver a ${CAMPANA_ANTARTIDA}`;
const TEXTO_VENDE_ANTARTIDA = `Vende, dejar en ${CAMPANA_ANTARTIDA}`;

export function normalizarNombreCampana(nombre: string): string {
  return nombre
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

export function hayCampanaNombrada(nombres: readonly string[], buscado: string): boolean {
  const clave = normalizarNombreCampana(buscado);
  return nombres.some((nombre) => normalizarNombreCampana(nombre) === clave);
}

export type TipoCampana = "enfriamiento" | "antartida" | "vendedor" | "otra";

// ENFRIAMIENTO y ANTÁRTIDA por nombre exacto; VENDEDOR por el comienzo
// ("VENDEDOR", "Vendedor 2", "VENDEDOR - Fajas"). Sin mayúsculas ni tildes.
export function tipoDeCampana(nombre: string): TipoCampana {
  const clave = normalizarNombreCampana(nombre);
  if (clave === normalizarNombreCampana(CAMPANA_ENFRIAMIENTO)) return "enfriamiento";
  if (clave === normalizarNombreCampana(CAMPANA_ANTARTIDA)) return "antartida";
  if (clave.startsWith(normalizarNombreCampana(CAMPANA_VENDEDOR))) return "vendedor";
  return "otra";
}

function cuantasConNombre(nombres: readonly string[], buscado: string): number {
  const clave = normalizarNombreCampana(buscado);
  return nombres.filter((nombre) => normalizarNombreCampana(nombre) === clave).length;
}

function motivoGastoSinVentas(gasto: string): string {
  return `Gastó ${mostrarDineroCompacto(gasto)} sin ventas`;
}

function textoAEnfriamiento(hayEnfriamiento: boolean): { codigo: CodigoRecomendacion; texto: string } {
  return hayEnfriamiento
    ? { codigo: "pasar_enfriamiento", texto: `Pasar a ${CAMPANA_ENFRIAMIENTO}` }
    : { codigo: "crear_enfriamiento", texto: `Crear la campaña ${CAMPANA_ENFRIAMIENTO} y mover este anuncio` };
}

function porcentaje(fraccion: string): string {
  const [entera, decimales = ""] = fraccion.split(".");
  const centesimas = `${entera}${decimales.padEnd(2, "0").slice(0, 2)}`.replace(/^0+(?=\d)/, "");
  return `${centesimas} %`;
}

// VENDEDOR: null si el anuncio se queda.
function motivoSalirDeVendedor(anuncio: AnuncioRecomendable): string | null {
  if (anuncio.acosSobreMaximo !== null) {
    return `ACOS ${porcentaje(anuncio.acosSobreMaximo)}, más que el máximo de ${porcentaje(ACOS_MAXIMO)}`;
  }
  if (anuncio.gastoUltimosDias !== null && !anuncio.vendioUltimosDias) {
    return `Gastó ${mostrarDineroCompacto(anuncio.gastoUltimosDias)} en los últimos ${DIAS_SIN_VENDER_VENDEDOR} días sin ventas`;
  }
  return null;
}

function motivoPasaTope(anuncio: AnuncioRecomendable): string {
  const base = motivoGastoSinVentas(anuncio.gasto ?? "0");
  return anuncio.topeConsumo ? `${base}, más que el tope de ${mostrarDineroCompacto(anuncio.topeConsumo)}` : base;
}

function motivoRoas(roas: string, objetivo: string, relacion: string): string {
  return `ROAS ${mostrarRoas(roas)}, ${relacion} el objetivo ${mostrarRoas(objetivo)}`;
}

function alcanza(roas: string | null, objetivo: string | null, factor: string): boolean {
  const frente = roasFrenteA(roas, objetivo, factor);
  return frente === "igual" || frente === "mayor";
}


function veces(factor: string): string {
  return `${factor.replace(".", ",")} veces`;
}

function nombreAnuncio(anuncio: AnuncioRecomendable): string {
  const titulo = anuncio.titulo?.trim() ?? "";
  return titulo === "" ? anuncio.itemId : titulo;
}

export function recomendarCampana(entrada: {
  aprendiendo: boolean;
  nombreCampana: string;
  nombresCampanas: readonly string[];
  roas: string | null;
  objetivo: string | null;
  anuncios: readonly AnuncioRecomendable[];
}): Recomendacion[] {
  if (entrada.aprendiendo) {
    return [
      {
        codigo: "aprendizaje",
        anuncioId: null,
        nombre: null,
        texto: TEXTO_APRENDIZAJE,
        motivo: "La campaña sigue en aprendizaje.",
      },
    ];
  }

  const salida: Recomendacion[] = [];
  if (
    roasFrenteA(entrada.roas, entrada.objetivo, UMBRAL_ROAS_BAJO) === "menor" &&
    entrada.roas !== null &&
    entrada.objetivo !== null
  ) {
    salida.push({
      codigo: "apagar",
      anuncioId: null,
      nombre: null,
      texto: TEXTO_APAGAR,
      motivo: motivoRoas(entrada.roas, entrada.objetivo, `bajo el ${porcentaje(UMBRAL_ROAS_BAJO)} de`),
    });
  } else if (alcanza(entrada.roas, entrada.objetivo, UMBRAL_EN_OBJETIVO) && entrada.roas !== null && entrada.objetivo !== null) {
    salida.push({
      codigo: "dejar_igual",
      anuncioId: null,
      nombre: null,
      texto: TEXTO_DEJAR_IGUAL,
      motivo: motivoRoas(entrada.roas, entrada.objetivo, "en o sobre"),
    });
  } else if (entrada.roas !== null && entrada.objetivo !== null) {
    salida.push({
      codigo: "vigilar",
      anuncioId: null,
      nombre: null,
      texto: TEXTO_VIGILAR,
      motivo: `ROAS ${mostrarRoas(entrada.roas)}, entre el ${porcentaje(UMBRAL_ROAS_BAJO)} y el 100 % del objetivo ${mostrarRoas(entrada.objetivo)}`,
    });
  }

  const tipo = tipoDeCampana(entrada.nombreCampana);
  const enEnfriamiento = tipo === "enfriamiento";
  const enAntartida = tipo === "antartida";
  // Una campaña con otro nombre se trata como VENDEDOR.
  const enVendedor = tipo === "vendedor" || tipo === "otra";
  const hayEnfriamiento = hayCampanaNombrada(entrada.nombresCampanas, CAMPANA_ENFRIAMIENTO);
  const hayAntartida = hayCampanaNombrada(entrada.nombresCampanas, CAMPANA_ANTARTIDA);

  if (tipo === "otra") {
    salida.push({
      codigo: "renombrar_vendedor",
      anuncioId: null,
      nombre: null,
      texto: TEXTO_RENOMBRAR,
      motivo: `Fuera de ${CAMPANA_ENFRIAMIENTO} y ${CAMPANA_ANTARTIDA}, toda campaña es ${CAMPANA_VENDEDOR}.`,
    });
  }
  if (enEnfriamiento || enAntartida) {
    const unica = enEnfriamiento ? CAMPANA_ENFRIAMIENTO : CAMPANA_ANTARTIDA;
    const cuantas = cuantasConNombre(entrada.nombresCampanas, unica);
    if (cuantas > 1) {
      salida.push({
        codigo: "campana_repetida",
        anuncioId: null,
        nombre: null,
        texto: `Debe haber una sola campaña ${unica}`,
        motivo: `La cuenta tiene ${cuantas} campañas con ese nombre.`,
      });
    }
  }
  const vendedores = entrada.anuncios.filter((anuncio) => tieneVentaAtribuida(anuncio.ingresos, anuncio.ventasCantidad));

  // ENFRIAMIENTO con algún anuncio que vende: la campaña pasa a ser
  // VENDEDOR. Solo se quitan los que no venden y pasan el tope.
  if (enEnfriamiento && vendedores.length > 0) {
    salida.push({
      codigo: "renombrar_vendedor",
      anuncioId: null,
      nombre: null,
      texto: TEXTO_RENOMBRAR,
      motivo: `${vendedores.length === 1 ? "Un anuncio vende" : `${vendedores.length} anuncios venden`} en ${CAMPANA_ENFRIAMIENTO}: ${vendedores
        .map(nombreAnuncio)
        .join(", ")}.`,
    });
    for (const anuncio of entrada.anuncios) {
      if (!gastaSinVender(anuncio.gasto, anuncio.ingresos, anuncio.ventasCantidad)) continue;
      if (anuncio.pasaTopeConsumo !== true) continue;
      salida.push({
        codigo: "quitar_de_campana",
        anuncioId: anuncio.id,
        nombre: nombreAnuncio(anuncio),
        texto: TEXTO_QUITAR,
        motivo: motivoPasaTope(anuncio),
      });
    }
    return salida;
  }

  for (const anuncio of entrada.anuncios) {
    const nombre = nombreAnuncio(anuncio);
    if (enVendedor) {
      // Mira los últimos 7 días, no el mes: un anuncio que vendió a
      // principio de mes y ya no vende igual vuelve a ENFRIAMIENTO.
      const motivo = motivoSalirDeVendedor(anuncio);
      if (motivo !== null) {
        salida.push({ ...textoAEnfriamiento(hayEnfriamiento), anuncioId: anuncio.id, nombre, motivo });
        continue;
      }
    } else if (gastaSinVender(anuncio.gasto, anuncio.ingresos, anuncio.ventasCantidad)) {
      if (enAntartida) {
        // Consume poquito: se deja. Sin precio no se sabe: no se pausa.
        if (anuncio.pasaTopeConsumo !== true) continue;
        salida.push({
          codigo: "pausar_antartida",
          anuncioId: anuncio.id,
          nombre,
          texto: TEXTO_PAUSAR_ANTARTIDA,
          motivo: motivoPasaTope(anuncio),
        });
        continue;
      }
      // Acá solo llega ENFRIAMIENTO: VENDEDOR (y otro nombre) ya se
      // resolvió arriba, ANTÁRTIDA también.
      salida.push({
        codigo: hayAntartida ? "mover_antartida" : "crear_antartida",
        anuncioId: anuncio.id,
        nombre,
        texto: hayAntartida
          ? `Mover a ${CAMPANA_ANTARTIDA}`
          : `Crear la campaña ${CAMPANA_ANTARTIDA} (presupuesto mínimo, ACOS alto) y mover este anuncio`,
        motivo: motivoGastoSinVentas(anuncio.gasto ?? "0"),
      });
      continue;
    }
    if (!tieneVentaAtribuida(anuncio.ingresos, anuncio.ventasCantidad)) continue;
    if (enAntartida) {
      salida.push({
        codigo: "nota_vende_antartida",
        anuncioId: anuncio.id,
        nombre,
        texto: TEXTO_VENDE_ANTARTIDA,
        motivo: "Tiene ventas atribuidas en el periodo.",
      });
      continue;
    }
    if (!alcanza(anuncio.roas, entrada.objetivo, FACTOR_ROAS_VENDE_BIEN) || anuncio.roas === null || entrada.objetivo === null) {
      continue;
    }
    salida.push({
      codigo: "nota_vende_bien",
      anuncioId: anuncio.id,
      nombre,
      texto: TEXTO_VENDE_BIEN,
      motivo: motivoRoas(anuncio.roas, entrada.objetivo, `al menos ${veces(FACTOR_ROAS_VENDE_BIEN)}`),
    });
  }
  return salida;
}
