import { describe, expect, it } from "vitest";
import { CAMPANA_ANTARTIDA, CAMPANA_ENFRIAMIENTO, CAMPANA_VENDEDOR } from "@/lib/publicidad/config";
import { hayCampanaNombrada, recomendarCampana, type AnuncioRecomendable } from "@/lib/publicidad/recomendaciones";

const anuncio = (parcial: Partial<AnuncioRecomendable> & Pick<AnuncioRecomendable, "id">): AnuncioRecomendable => ({
  titulo: "Producto",
  itemId: "MCO1",
  gasto: null,
  ingresos: null,
  ventasCantidad: null,
  roas: null,
  pasaTopeConsumo: null,
  topeConsumo: null,
  acosSobreMaximo: null,
  gastoUltimosDias: null,
  vendioUltimosDias: false,
  ...parcial,
});

const base = {
  aprendiendo: false,
  nombreCampana: "Campaña 1",
  nombresCampanas: ["Campaña 1"],
  roas: "9.85",
  objetivo: "12.00",
  anuncios: [] as AnuncioRecomendable[],
};

describe("recomendaciones de publicidad (issue #255)", () => {
  it("en aprendizaje no recomienda nada, ni pasar a enfriamiento", () => {
    const textos = recomendarCampana({
      ...base,
      aprendiendo: true,
      roas: "1.00",
      anuncios: [anuncio({ id: "1", gasto: "10.00", ingresos: "0.00", ventasCantidad: "0" })],
    }).map((item) => item.texto);
    expect(textos).toEqual(["En aprendizaje, no tocar todavía"]);
  });

  it("bajo el 70 % del objetivo pide apagar, y el 70 % justo no", () => {
    const bajo = recomendarCampana({ ...base, roas: "8.00", objetivo: "12.00" });
    expect(bajo.map((item) => item.texto)).toEqual(["Apagar y crear una nueva"]);
    expect(bajo[0].motivo).toContain("8,00x");
    expect(bajo[0].motivo).toContain("12,00x");
    expect(recomendarCampana({ ...base, roas: "8.40", objetivo: "12.00" })).toEqual([]);
  });

  it("con ROAS holgado solo sugiere ajustar el objetivo, nunca el presupuesto", () => {
    const holgado = recomendarCampana({ ...base, roas: "15.60", objetivo: "12.00" });
    expect(holgado.map((item) => item.texto)).toEqual(["Subir el objetivo de ROAS / bajar ACOS objetivo"]);
    expect(holgado[0].motivo).toContain("15,60x");
    expect(recomendarCampana({ ...base, roas: "15.59", objetivo: "12.00" })).toEqual([]);
    const unidos = holgado.map((item) => `${item.texto} ${item.motivo}`).join(" ");
    expect(unidos).not.toMatch(/presupuesto/i);
    expect(unidos).not.toMatch(/bajar el objetivo de ROAS/i);
    expect(unidos).not.toMatch(/compartir presupuesto/i);
  });

  it("el que gasta sin vender pasa a enfriamiento, con el monto real", () => {
    const recs = recomendarCampana({
      ...base,
      nombresCampanas: ["Campaña 1", "Enfriamiento"],
      anuncios: [anuncio({ id: "1", gasto: "10.00", ingresos: "0.00", ventasCantidad: "0" })],
    });
    expect(recs.map((item) => item.texto)).toEqual([`Pasar a ${CAMPANA_ENFRIAMIENTO}`]);
    expect(recs[0].motivo).toBe("Gastó $10 sin ventas");
  });

  it("en enfriamiento, sin antártida, pide crearla; si ya existe, mover", () => {
    const anuncioSinVenta = anuncio({ id: "1", gasto: "25.00", ingresos: null, ventasCantidad: null });
    const crear = recomendarCampana({
      ...base,
      nombreCampana: "enfriamiento",
      nombresCampanas: ["enfriamiento"],
      anuncios: [anuncioSinVenta],
    });
    expect(crear.map((item) => item.codigo)).toEqual(["crear_antartida"]);
    expect(crear[0].texto).toBe(`Crear la campaña ${CAMPANA_ANTARTIDA} (presupuesto mínimo, ACOS alto) y mover este anuncio`);
    expect(crear[0].motivo).toBe("Gastó $25 sin ventas");

    const mover = recomendarCampana({
      ...base,
      nombreCampana: CAMPANA_ENFRIAMIENTO,
      nombresCampanas: [CAMPANA_ENFRIAMIENTO, "antartida"],
      anuncios: [anuncioSinVenta],
    });
    expect(mover.map((item) => item.texto)).toEqual([`Mover a ${CAMPANA_ANTARTIDA}`]);
    expect(hayCampanaNombrada(["Antártida"], CAMPANA_ANTARTIDA)).toBe(true);
  });

  it("sin campaña ENFRIAMIENTO en la cuenta, sugiere crearla (regla del 14-nov)", () => {
    const recs = recomendarCampana({
      ...base,
      anuncios: [anuncio({ id: "1", gasto: "10.00", ingresos: "0.00", ventasCantidad: "0" })],
    });
    expect(recs.map((item) => item.codigo)).toEqual(["crear_enfriamiento"]);
    expect(recs[0].texto).toBe(`Crear la campaña ${CAMPANA_ENFRIAMIENTO} y mover este anuncio`);
  });

  it("en antártida, el que no vende y consume poquito (o sin precio) se deja, sin sugerencia de enfriamiento", () => {
    const recs = recomendarCampana({
      ...base,
      nombreCampana: "Antartida",
      nombresCampanas: ["Antartida", CAMPANA_ENFRIAMIENTO],
      anuncios: [
        anuncio({ id: "1", gasto: "10.00", ingresos: "0.00", ventasCantidad: "0", pasaTopeConsumo: false }),
        anuncio({ id: "2", gasto: "10.00", ingresos: "0.00", ventasCantidad: "0", pasaTopeConsumo: null }),
      ],
    });
    expect(recs.filter((item) => item.anuncioId !== null)).toEqual([]);
  });

  it("en antártida, el que no vende y pasa el tope se pausa 7 días; el que vende se queda", () => {
    const recs = recomendarCampana({
      ...base,
      nombreCampana: "ANTÁRTIDA",
      nombresCampanas: ["ANTÁRTIDA"],
      anuncios: [
        anuncio({ id: "1", titulo: "Gasta", gasto: "8000.00", ingresos: "0.00", ventasCantidad: "0", pasaTopeConsumo: true, topeConsumo: "5000.00" }),
        anuncio({ id: "2", titulo: "Vende", gasto: "3000.00", ingresos: "90000.00", ventasCantidad: "1" }),
      ],
    });
    expect(recs.map((item) => item.codigo)).toEqual(["pausar_antartida", "nota_vende_antartida"]);
    expect(recs[0].texto).toBe(`Pausar o sacar de la campaña 7 días; después, volver a ${CAMPANA_ANTARTIDA}`);
    expect(recs[0].motivo).toContain("más que el tope de");
    expect(recs[1].texto).toBe(`Vende, dejar en ${CAMPANA_ANTARTIDA}`);
  });

  it("en VENDEDOR: 7 días sin vender o ACOS sobre el 20 % vuelve a ENFRIAMIENTO; el que vende se queda", () => {
    const recs = recomendarCampana({
      ...base,
      nombreCampana: "Vendedor",
      nombresCampanas: ["Vendedor", "ENFRIAMIENTO"],
      anuncios: [
        anuncio({ id: "1", titulo: "SieteDias", gasto: "9000.00", ingresos: "50000.00", ventasCantidad: "1", gastoUltimosDias: "4000.00", vendioUltimosDias: false }),
        anuncio({ id: "2", titulo: "AcosAlto", gasto: "30000.00", ingresos: "100000.00", ventasCantidad: "2", acosSobreMaximo: "0.3000", gastoUltimosDias: "5000.00", vendioUltimosDias: true }),
        anuncio({ id: "3", titulo: "Bien", gasto: "5000.00", ingresos: "100000.00", ventasCantidad: "3", gastoUltimosDias: "2000.00", vendioUltimosDias: true }),
        anuncio({ id: "4", titulo: "Pausado", gasto: "5000.00", ingresos: "0.00", ventasCantidad: "0", gastoUltimosDias: null, vendioUltimosDias: false }),
      ],
    });
    const porAnuncio = recs.filter((item) => item.anuncioId !== null);
    expect(porAnuncio.map((item) => [item.anuncioId, item.codigo])).toEqual([
      ["1", "pasar_enfriamiento"],
      ["2", "pasar_enfriamiento"],
    ]);
    expect(porAnuncio[0].motivo).toBe("Gastó $4.000 en los últimos 7 días sin ventas");
    expect(porAnuncio[1].motivo).toBe("ACOS 30 %, más que el máximo de 20 %");

    const sinEnfriamiento = recomendarCampana({
      ...base,
      nombreCampana: "VENDEDOR",
      nombresCampanas: ["VENDEDOR"],
      anuncios: [anuncio({ id: "1", gasto: "4000.00", gastoUltimosDias: "4000.00", vendioUltimosDias: false })],
    });
    expect(sinEnfriamiento.map((item) => item.codigo)).toEqual(["crear_enfriamiento"]);
  });

  it("en enfriamiento con un vendedor: renombrar a VENDEDOR y quitar solo los que pasan el tope", () => {
    const recs = recomendarCampana({
      ...base,
      nombreCampana: "Enfriamiento",
      nombresCampanas: ["Enfriamiento"],
      anuncios: [
        anuncio({ id: "1", titulo: "Vende", gasto: "3000.00", ingresos: "90000.00", ventasCantidad: "1" }),
        anuncio({ id: "2", titulo: "Pasa", gasto: "8000.00", ingresos: "0.00", ventasCantidad: "0", pasaTopeConsumo: true, topeConsumo: "5000.00" }),
        anuncio({ id: "3", titulo: "Poquito", gasto: "100.00", ingresos: "0.00", ventasCantidad: "0", pasaTopeConsumo: false }),
        anuncio({ id: "4", titulo: "SinPrecio", gasto: "100.00", ingresos: "0.00", ventasCantidad: "0", pasaTopeConsumo: null }),
      ],
    });
    expect(recs.map((item) => item.codigo)).toEqual(["renombrar_vendedor", "quitar_de_campana"]);
    expect(recs[0].texto).toBe(`Cambiar el nombre de la campaña a ${CAMPANA_VENDEDOR}`);
    expect(recs[0].motivo).toContain("Vende");
    expect(recs[1].anuncioId).toBe("2");
    expect(recs.map((item) => item.codigo)).not.toContain("crear_antartida");
  });

  it("el que vende bien se queda: es una nota, no un traslado", () => {
    const recs = recomendarCampana({
      ...base,
      anuncios: [anuncio({ id: "1", gasto: "10.00", ingresos: "180.00", ventasCantidad: "2", roas: "18.00" })],
    });
    expect(recs.map((item) => item.texto)).toEqual(["Vende bien, dejar en esta campaña"]);
    expect(recs[0].motivo).toContain("18,00x");
    expect(recs.map((item) => item.texto).join(" ")).not.toMatch(/Mover a ENFRIAMIENTO/);
    expect(recomendarCampana({
      ...base,
      anuncios: [anuncio({ id: "1", gasto: "10.00", ingresos: "179.90", ventasCantidad: "1", roas: "17.99" })],
    })).toEqual([]);
  });
});
