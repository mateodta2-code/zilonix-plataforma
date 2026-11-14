// Issue #255 — textos de recomendación. No hay botón ni llamada a
// Mercado Libre: la pantalla solo los muestra. Nunca se sugiere subir
// el presupuesto, bajar el objetivo de ROAS ni compartir presupuesto.
// Enfriamiento es solo para anuncios que gastan sin vender. El que
// vende bien se queda en la campaña donde ya funciona.
//
// Reglas del negocio (14-nov):
// - Campaña normal: el que gasta sin vender pasa a ENFRIAMIENTO. Si la
//   cuenta no tiene esa campaña, se sugiere crearla.
// - ENFRIAMIENTO con algún anuncio que vende: la campaña se renombra a
//   VENDEDOR y se quitan solo los que no venden y PASAN el tope de
//   consumo. Los que consumen poquito se pueden dejar.
// - ENFRIAMIENTO sin ninguna venta: los que gastan sin vender pasan a
//   ANTÁRTIDA (o se crea).
// - ANTÁRTIDA: el que vende se queda. El que no vende y pasa el tope se
//   pausa o se saca 7 días y después vuelve a ANTÁRTIDA.
// El tope de consumo es el del semáforo del anuncio (gasto sin ventas
// sobre el 5 % del precio, TOPE_GASTO_SIN_VENTAS). Sin precio no se
// sabe: no se sugiere quitar ni pausar.

import { mostrarDineroCompacto, mostrarRoas } from "@/lib/publicidad/formato";
import {
  CAMPANA_ANTARTIDA,
  CAMPANA_ENFRIAMIENTO,
  CAMPANA_VENDEDOR,
  DIAS_PAUSA_ANTARTIDA,
  FACTOR_ROAS_HOLGADO,
  FACTOR_ROAS_VENDE_BIEN,
  UMBRAL_ROAS_BAJO,
} from "@/lib/publicidad/config";
import { gastaSinVender, roasFrenteA, tieneVentaAtribuida } from "@/lib/publicidad/kpis";

export type CodigoRecomendacion =
  | "aprendizaje"
  | "apagar"
  | "subir_objetivo"
  | "pasar_enfriamiento"
  | "crear_enfriamiento"
  | "mover_antartida"
  | "crear_antartida"
  | "renombrar_vendedor"
  | "quitar_de_campana"
  | "pausar_antartida"
  | "nota_vende_bien"
  | "nota_vende_antartida";

// Notas, no acciones: la pantalla las pinta en tono neutro.
export const CODIGOS_NOTA: readonly CodigoRecomendacion[] = ["aprendizaje", "nota_vende_bien", "nota_vende_antartida"];

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
};

const TEXTO_APRENDIZAJE = "En aprendizaje, no tocar todavía";
const TEXTO_APAGAR = "Apagar y crear una nueva";
const TEXTO_SUBIR_OBJETIVO = "Subir el objetivo de ROAS / bajar ACOS objetivo";
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

function motivoGastoSinVentas(gasto: string): string {
  return `Gastó ${mostrarDineroCompacto(gasto)} sin ventas`;
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

function umbralVisible(): string {
  const [entera, fraccion = ""] = UMBRAL_ROAS_BAJO.split(".");
  const porcentaje = `${entera}${fraccion.padEnd(2, "0").slice(0, 2)}`.replace(/^0+/, "") || "0";
  return `${porcentaje} %`;
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
      motivo: motivoRoas(entrada.roas, entrada.objetivo, `bajo el ${umbralVisible()} de`),
    });
  } else if (
    alcanza(entrada.roas, entrada.objetivo, FACTOR_ROAS_HOLGADO) &&
    entrada.roas !== null &&
    entrada.objetivo !== null
  ) {
    salida.push({
      codigo: "subir_objetivo",
      anuncioId: null,
      nombre: null,
      texto: TEXTO_SUBIR_OBJETIVO,
      motivo: motivoRoas(entrada.roas, entrada.objetivo, `al menos ${veces(FACTOR_ROAS_HOLGADO)}`),
    });
  }

  const enEnfriamiento = hayCampanaNombrada([entrada.nombreCampana], CAMPANA_ENFRIAMIENTO);
  const enAntartida = hayCampanaNombrada([entrada.nombreCampana], CAMPANA_ANTARTIDA);
  const hayEnfriamiento = hayCampanaNombrada(entrada.nombresCampanas, CAMPANA_ENFRIAMIENTO);
  const hayAntartida = hayCampanaNombrada(entrada.nombresCampanas, CAMPANA_ANTARTIDA);
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
    if (gastaSinVender(anuncio.gasto, anuncio.ingresos, anuncio.ventasCantidad)) {
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
      const motivo = motivoGastoSinVentas(anuncio.gasto ?? "0");
      if (enEnfriamiento) {
        salida.push({
          codigo: hayAntartida ? "mover_antartida" : "crear_antartida",
          anuncioId: anuncio.id,
          nombre,
          texto: hayAntartida
            ? `Mover a ${CAMPANA_ANTARTIDA}`
            : `Crear la campaña ${CAMPANA_ANTARTIDA} (presupuesto mínimo, ACOS alto) y mover este anuncio`,
          motivo,
        });
      } else {
        salida.push({
          codigo: hayEnfriamiento ? "pasar_enfriamiento" : "crear_enfriamiento",
          anuncioId: anuncio.id,
          nombre,
          texto: hayEnfriamiento ? `Pasar a ${CAMPANA_ENFRIAMIENTO}` : `Crear la campaña ${CAMPANA_ENFRIAMIENTO} y mover este anuncio`,
          motivo,
        });
      }
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
