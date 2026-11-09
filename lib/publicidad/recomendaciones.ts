// Issue #255 — textos de recomendación. No hay botón ni llamada a
// Mercado Libre: la pantalla solo los muestra. Nunca se sugiere subir
// el presupuesto, bajar el objetivo de ROAS ni compartir presupuesto.
// Enfriamiento es solo para anuncios que gastan sin vender. El que
// vende bien se queda en la campaña donde ya funciona.

import { mostrarDineroCompacto, mostrarRoas } from "@/lib/publicidad/formato";
import {
  CAMPANA_ANTARTIDA,
  CAMPANA_ENFRIAMIENTO,
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
  | "mover_antartida"
  | "crear_antartida"
  | "nota_vende_bien";

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
};

const TEXTO_APRENDIZAJE = "En aprendizaje, no tocar todavía";
const TEXTO_APAGAR = "Apagar y crear una nueva";
const TEXTO_SUBIR_OBJETIVO = "Subir el objetivo de ROAS / bajar ACOS objetivo";
const TEXTO_VENDE_BIEN = "Vende bien, dejar en esta campaña";

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
  const hayAntartida = hayCampanaNombrada(entrada.nombresCampanas, CAMPANA_ANTARTIDA);

  for (const anuncio of entrada.anuncios) {
    const nombre = nombreAnuncio(anuncio);
    if (gastaSinVender(anuncio.gasto, anuncio.ingresos, anuncio.ventasCantidad)) {
      if (enAntartida) continue;
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
          codigo: "pasar_enfriamiento",
          anuncioId: anuncio.id,
          nombre,
          texto: `Pasar a ${CAMPANA_ENFRIAMIENTO}`,
          motivo,
        });
      }
      continue;
    }
    if (!tieneVentaAtribuida(anuncio.ingresos, anuncio.ventasCantidad)) continue;
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
