import { describe, expect, it } from "vitest";
import { CAMPANA_ANTARTIDA, CAMPANA_ENFRIAMIENTO } from "@/lib/publicidad/config";
import { hayCampanaNombrada, recomendarCampana, type AnuncioRecomendable } from "@/lib/publicidad/recomendaciones";

const anuncio = (parcial: Partial<AnuncioRecomendable> & Pick<AnuncioRecomendable, "id">): AnuncioRecomendable => ({
  titulo: "Producto",
  itemId: "MCO1",
  gasto: null,
  ingresos: null,
  ventasCantidad: null,
  roas: null,
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

  it("un anuncio que ya está en antártida no recibe sugerencia de enfriamiento ni de antártida", () => {
    const recs = recomendarCampana({
      ...base,
      nombreCampana: "Antartida",
      nombresCampanas: ["Antartida", CAMPANA_ENFRIAMIENTO],
      anuncios: [anuncio({ id: "1", gasto: "10.00", ingresos: "0.00", ventasCantidad: "0" })],
    });
    expect(recs.filter((item) => item.anuncioId !== null)).toEqual([]);
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
