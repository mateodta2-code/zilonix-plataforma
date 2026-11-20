import { describe, expect, it } from "vitest";
import { camposPorConfirmar, extraerJson, fichaConfirmada, fichaEnTexto, idiomaDeSitio, leerFicha } from "@/lib/publicaciones/ficha";

describe("leerFicha (nunca confía en lo que llega)", () => {
  it("«N/A», «desconocido» y vacíos quedan en null, nunca se muestran", () => {
    const f = leerFicha({ nombre: { valor: "Termo de acero 1 L", origen: "foto" }, color: { valor: "N/A", origen: "foto" }, material: { valor: "desconocido", origen: "supuesto" } });
    expect(f.nombre).toEqual({ valor: "Termo de acero 1 L", origen: "foto" });
    expect(f.color.valor).toBeNull();
    expect(f.material.valor).toBeNull();
  });

  it("el origen es obligatorio: sin origen válido cuenta como «supuesto»", () => {
    const f = leerFicha({ nombre: { valor: "Termo" }, uso: { valor: "Café", origen: "inventado" }, color: "Negro" });
    expect(f.nombre.origen).toBe("supuesto");
    expect(f.uso.origen).toBe("supuesto");
    expect(f.color).toEqual({ valor: "Negro", origen: "supuesto" });
  });

  it("listas limpias y medidas anidadas o planas", () => {
    const f = leerFicha({ incluye: { valor: ["Termo", " ", "N/A", "Tapa"], origen: "vendedor" }, medidas: { alto: { valor: "31 cm", origen: "vendedor" } }, peso: { valor: "450 g", origen: "foto" } });
    expect(f.incluye.valor).toEqual(["Termo", "Tapa"]);
    expect(f.alto).toEqual({ valor: "31 cm", origen: "vendedor" });
    expect(f.peso.valor).toBe("450 g");
  });
});

describe("confirmar la ficha", () => {
  it("un «supuesto» con valor bloquea; borrado o aceptado, se puede confirmar", () => {
    const f = leerFicha({ nombre: { valor: "Termo", origen: "vendedor" }, capacidad: { valor: "1 L", origen: "supuesto" } });
    expect(camposPorConfirmar(f)).toEqual(["capacidad"]);
    expect(fichaConfirmada(f)).toBe(false);
    expect(fichaConfirmada({ ...f, capacidad: { valor: "1 L", origen: "vendedor" } })).toBe(true);
    expect(fichaConfirmada({ ...f, capacidad: { valor: null, origen: "supuesto" } })).toBe(true);
    expect(fichaConfirmada(leerFicha({}))).toBe(false); // sin nombre no hay ficha
  });

  it("en texto para los prompts solo va lo que tiene valor", () => {
    const t = fichaEnTexto(leerFicha({ nombre: { valor: "Termo", origen: "vendedor" }, incluye: { valor: ["Tapa"], origen: "foto" } }));
    expect(t).toBe("- Nombre del producto: Termo\n- Qué incluye: Tapa");
  });
});

describe("idioma y JSON", () => {
  it("el idioma sale del país de la cuenta, nunca es-CO fijo", () => {
    expect(idiomaDeSitio("MLB")).toEqual({ idioma: "pt-BR", pais: "Brasil" });
    expect(idiomaDeSitio("MLM")).toEqual({ idioma: "es-MX", pais: "México" });
    expect(idiomaDeSitio("MCO").idioma).toBe("es-CO");
  });

  it("saca el JSON aunque venga envuelto; inválido → null", () => {
    expect(extraerJson('Claro:\n```json\n{"a": 1}\n```')).toEqual({ a: 1 });
    expect(extraerJson("no sé")).toBeNull();
    expect(extraerJson("{roto")).toBeNull();
    expect(extraerJson("[1,2]")).toBeNull();
  });
});
