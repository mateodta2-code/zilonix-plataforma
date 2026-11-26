import { describe, expect, it } from "vitest";
import { leerPreguntasMl, leerReclamosMl } from "@/lib/ml/cliente";
import { minutosDesde, rotuloEtapaReclamo, rotuloTipoReclamo, textoEspera, tonoEspera } from "@/lib/preguntas/tiempo";

const AHORA = new Date("2026-11-17T15:00:00-05:00");

describe("tiempo de espera de una pregunta", () => {
  it("minutos desde la fecha de Mercado Libre", () => {
    expect(minutosDesde("2026-11-17T14:30:00.000-05:00", AHORA)).toBe(30);
    expect(minutosDesde(null, AHORA)).toBeNull();
    expect(minutosDesde("no es fecha", AHORA)).toBeNull();
    // Un reloj adelantado no da minutos negativos.
    expect(minutosDesde("2026-11-17T15:05:00-05:00", AHORA)).toBe(0);
  });

  it("texto corto", () => {
    expect(textoEspera(0)).toBe("hace un momento");
    expect(textoEspera(45)).toBe("hace 45 min");
    expect(textoEspera(150)).toBe("hace 2 h");
    expect(textoEspera(60 * 24)).toBe("hace 1 día");
    expect(textoEspera(60 * 24 * 3)).toBe("hace 3 días");
    expect(textoEspera(null)).toBe("—");
  });

  it("color: verde bajo 1 h, amarillo bajo 12 h, rojo desde 12 h", () => {
    expect(tonoEspera(59)).toBe("exito");
    expect(tonoEspera(60)).toBe("advertencia");
    expect(tonoEspera(12 * 60 - 1)).toBe("advertencia");
    expect(tonoEspera(12 * 60)).toBe("peligro");
    expect(tonoEspera(null)).toBe("neutro");
  });

  it("rótulos de reclamos: los conocidos traducidos, los demás tal cual", () => {
    expect(rotuloTipoReclamo("mediations")).toBe("Mediación");
    expect(rotuloEtapaReclamo("dispute")).toBe("Disputa");
    expect(rotuloTipoReclamo("otro_tipo")).toBe("otro_tipo");
    expect(rotuloEtapaReclamo(null)).toBe("—");
  });
});

describe("lectura de las respuestas de Mercado Libre (forma confirmada en staging)", () => {
  it("preguntas: toma id, texto, ítem y fecha; descarta filas sin id", () => {
    const r = leerPreguntasMl({
      total: 3,
      questions: [
        { id: 13000000001, text: "¿Tiene stock?", item_id: "MCO123", date_created: "2026-11-17T10:00:00.000-04:00", status: "UNANSWERED", from: { id: 1 } },
        { text: "sin id" },
        { id: "13000000002", text: 99, item_id: null },
      ],
    });
    expect(r.total).toBe(3);
    expect(r.preguntas).toEqual([
      { id: "13000000001", texto: "¿Tiene stock?", itemId: "MCO123", fecha: "2026-11-17T10:00:00.000-04:00" },
      { id: "13000000002", texto: "", itemId: null, fecha: null },
    ]);
  });

  it("reclamos: paging.total y los campos de la lista", () => {
    const r = leerReclamosMl({
      paging: { total: 1, offset: 0, limit: 30 },
      data: [
        {
          id: 5000000001,
          resource_id: 2000000001,
          status: "opened",
          type: "mediations",
          stage: "dispute",
          resource: "order",
          reason_id: "PDD9939",
          date_created: "2026-11-10T09:00:00.000-04:00",
          last_updated: "2026-11-16T09:00:00.000-04:00",
        },
      ],
    });
    expect(r.total).toBe(1);
    expect(r.reclamos[0]).toEqual({
      id: "5000000001",
      jugadores: [],
      recursoId: "2000000001",
      recurso: "order",
      tipo: "mediations",
      etapa: "dispute",
      estado: "opened",
      motivo: "PDD9939",
      fecha: "2026-11-10T09:00:00.000-04:00",
      actualizado: "2026-11-16T09:00:00.000-04:00",
    });
  });

  it("una respuesta rara no rompe la pantalla", () => {
    expect(leerPreguntasMl(null)).toEqual({ total: 0, preguntas: [] });
    expect(leerReclamosMl({ data: "x" })).toEqual({ total: 0, reclamos: [] });
  });
});

import { compararPlazo, minutosHasta, textoPlazo, tonoPlazo } from "@/lib/preguntas/tiempo";

describe("plazo de un reclamo (Reclamos-A)", () => {
  const ahora = new Date("2026-11-25T12:00:00Z");
  it("minutos hasta la fecha, negativo si ya pasó", () => {
    expect(minutosHasta("2026-11-27T12:00:00Z", ahora)).toBe(2 * 24 * 60);
    expect(minutosHasta("2026-11-25T11:00:00Z", ahora)).toBe(-60);
    expect(minutosHasta(null, ahora)).toBeNull();
  });
  it("texto y tono según urgencia", () => {
    expect(textoPlazo(2 * 24 * 60)).toBe("vence en 2 días");
    expect(textoPlazo(5 * 60)).toBe("vence en 5 h");
    expect(textoPlazo(-1)).toBe("plazo vencido");
    expect(tonoPlazo(23 * 60)).toBe("peligro");
    expect(tonoPlazo(2 * 24 * 60)).toBe("advertencia");
    expect(tonoPlazo(5 * 24 * 60)).toBe("exito");
  });
  it("ordena por plazo más cercano, sin plazo al final", () => {
    const orden = ["2026-12-01T00:00:00Z", null, "2026-11-26T00:00:00Z"].sort(compararPlazo);
    expect(orden).toEqual(["2026-11-26T00:00:00Z", "2026-12-01T00:00:00Z", null]);
  });
});
