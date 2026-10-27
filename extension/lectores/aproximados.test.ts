import { describe, expect, it } from "vitest";
import {
  antiguedadDias as antiguedadDiasApp,
  facturacionMes as facturacionMesApp,
  ventasMes as ventasMesApp,
  vendidosEstimados as vendidosEstimadosApp,
} from "../../lib/seguimiento/aproximados";
import calibracionReal from "../../lib/seguimiento/calibracion-aproximados.json";
// Issue #262 — extension/lectores/aproximados.js es JS plano (corre
// como content script, sin build) pero exporta sus funciones con
// `module.exports` cuando `module` existe (mismo patrón dual que
// extension/utilidades.js) — alcanza para que vitest lo importe
// directo, sin un navegador real.
import { antiguedadDias, antiguedadDiasPorId, facturacionMes, numeroYPrefijoDeId, ventasMes, vendidosEstimados } from "./aproximados.js";

const UN_DIA_MS = 24 * 60 * 60 * 1000;

describe("vendidosEstimados — issue #262 (mismo cálculo que lib/seguimiento/aproximados.ts)", () => {
  it("dato exacto: se usa tal cual, nunca se multiplica", () => {
    expect(vendidosEstimados(537, { exacto: true, esFull: true }, calibracionReal)).toBe(537);
  });

  it('"+N vendidos" Full: N × 2.2 (caso real de referencia, "+100" -> 220)', () => {
    expect(vendidosEstimados(100, { exacto: false, esFull: true }, calibracionReal)).toBeCloseTo(220, 9);
  });

  it('"+N vendidos" sin Full: N × 1.55', () => {
    expect(vendidosEstimados(100, { exacto: false, esFull: false }, calibracionReal)).toBeCloseTo(155, 9);
  });

  it("sin dato de vendidos, o negativo -> null, nunca inventa", () => {
    expect(vendidosEstimados(null, { exacto: false, esFull: true }, calibracionReal)).toBeNull();
    expect(vendidosEstimados(-5, { exacto: false, esFull: true }, calibracionReal)).toBeNull();
  });
});

describe("antiguedadDiasPorId — issue #262 (interpolación, mismo criterio que el lado del servidor)", () => {
  const puntos = [
    { id: "MCO1000000000", tipo: "item", fecha: "2024-01-01T05:00:00.000Z" },
    { id: "MCO1100000000", tipo: "item", fecha: "2025-01-01T05:00:00.000Z" },
  ];

  it("interpola linealmente un id que cae entre dos puntos calibrados", () => {
    const ahoraMs = new Date("2025-01-01T05:00:00.000Z").getTime();
    const dias = antiguedadDiasPorId("MCO1050000000", "item", ahoraMs, puntos);
    expect(dias).not.toBeNull();
    expect(dias).toBeGreaterThan(180);
    expect(dias).toBeLessThan(186);
  });

  it("nunca mezcla ids de países distintos ni de tipo distinto (item vs product)", () => {
    const ahoraMs = new Date("2025-06-01T05:00:00.000Z").getTime();
    expect(antiguedadDiasPorId("MLA1050000000", "item", ahoraMs, puntos)).toBeNull();
    expect(antiguedadDiasPorId("MCO1050000000", "product", ahoraMs, puntos)).toBeNull();
  });

  it("con menos de 2 puntos del mismo tipo, o un id sin el patrón real -> null, nunca inventa", () => {
    const ahoraMs = new Date("2025-06-01T05:00:00.000Z").getTime();
    expect(antiguedadDiasPorId("MCO1050000000", "item", ahoraMs, [puntos[0]])).toBeNull();
    expect(antiguedadDiasPorId("no-es-un-id-real", "item", ahoraMs, puntos)).toBeNull();
  });
});

describe("antiguedadDias — issue #262 (date_created real gana siempre que esté)", () => {
  it("con date_created real -> días reales, nunca interpola por id", () => {
    const ahora = new Date("2026-01-01T00:00:00.000Z");
    const haceUnMes = new Date(ahora.getTime() - 30 * UN_DIA_MS);
    const dias = antiguedadDias({ dateCreated: haceUnMes.toISOString(), mlId: "MCO9999999999", tipo: "item", ahoraMs: ahora.getTime() }, calibracionReal);
    expect(dias).toBeCloseTo(30, 6);
  });

  it("sin date_created y sin puntos calibrados todavía -> null (el estado real de hoy, tabla vacía)", () => {
    const ahoraMs = Date.now();
    expect(antiguedadDias({ dateCreated: null, mlId: "MCO1050000000", tipo: "item", ahoraMs }, calibracionReal)).toBeNull();
  });
});

describe("ventasMes/facturacionMes — issue #262 (mismas fórmulas que el lado del servidor)", () => {
  it("ventasMes: vendidos estimados × min(30, días) / días", () => {
    expect(ventasMes(300, 90)).toBeCloseTo(100, 6);
    expect(ventasMes(3, 5)).toBe(3); // menos de 30 días, nunca infla sobre poco historial
  });

  it("facturacionMes: ventas/mes × precio", () => {
    expect(facturacionMes(10, 50000)).toBe(500000);
  });

  it("sin datos válidos -> null, nunca inventa", () => {
    expect(ventasMes(null, 90)).toBeNull();
    expect(ventasMes(100, 0)).toBeNull();
    expect(facturacionMes(null, 50000)).toBeNull();
  });
});

// Issue #262 (pedido explícito de la tarea) — "Agrega un test que
// compruebe que la app y la extensión dan el mismo resultado": compara
// extension/lectores/aproximados.js contra lib/seguimiento/aproximados.ts
// con los MISMOS datos de entrada (incluido el caso real de referencia
// de Selltrix, catálogo MCO64541261) — si alguno de los dos cambia su
// fórmula sin el otro, esta prueba lo detecta.
describe("la app y la extensión dan el MISMO resultado (issue #262)", () => {
  it("caso real de referencia completo (Selltrix, catálogo): 220 / 41 / $3.267.910 en los dos lados", () => {
    const diasExactos = 66000 / 409; // mismo despeje que lib/seguimiento/aproximados.test.ts
    const ahora = new Date("2026-10-27T00:00:00.000Z");
    const dateCreated = new Date(ahora.getTime() - diasExactos * UN_DIA_MS);
    const precio = 79900;

    const vendidosApp = vendidosEstimadosApp(100, { exacto: false, esFull: true });
    const vendidosExt = vendidosEstimados(100, { exacto: false, esFull: true }, calibracionReal);
    expect(vendidosExt).toBeCloseTo(vendidosApp as number, 9);

    const diasApp = antiguedadDiasApp({ dateCreated, mlId: null, recursoMl: null, ahora });
    const diasExt = antiguedadDias({ dateCreated: dateCreated.toISOString(), mlId: null, tipo: "item", ahoraMs: ahora.getTime() }, calibracionReal);
    expect(diasExt).toBeCloseTo(diasApp as number, 6);

    const ventasMesAppValor = ventasMesApp(vendidosApp, diasApp);
    const ventasMesExtValor = ventasMes(vendidosExt, diasExt);
    expect(ventasMesExtValor).toBeCloseTo(ventasMesAppValor as number, 6);
    expect(Math.round(ventasMesExtValor as number)).toBe(41);

    const facturacionAppValor = facturacionMesApp(ventasMesAppValor, precio);
    const facturacionExtValor = facturacionMes(ventasMesExtValor, precio);
    expect(facturacionExtValor).toBeCloseTo(facturacionAppValor as number, 2);
    expect(facturacionExtValor).toBeCloseTo(3267910, 2);
  });

  it("con puntos de calibración reales (no solo date_created), interpolar por id da el MISMO resultado en los dos lados", () => {
    const puntosApp = [
      { id: "MCO1000000000", tipo: "item" as const, fecha: new Date("2024-01-01T05:00:00.000Z") },
      { id: "MCO1100000000", tipo: "item" as const, fecha: new Date("2025-01-01T05:00:00.000Z") },
    ];
    const puntosExt = [
      { id: "MCO1000000000", tipo: "item", fecha: "2024-01-01T05:00:00.000Z" },
      { id: "MCO1100000000", tipo: "item", fecha: "2025-01-01T05:00:00.000Z" },
    ];
    const ahora = new Date("2025-06-01T05:00:00.000Z");

    const diasApp = antiguedadDiasApp({ dateCreated: null, mlId: "MCO1050000000", recursoMl: "item", ahora, puntos: puntosApp });
    const diasExt = antiguedadDias(
      { dateCreated: null, mlId: "MCO1050000000", tipo: "item", ahoraMs: ahora.getTime() },
      { factorVendidosFull: 2.2, factorVendidosSinFull: 1.55, puntos: puntosExt }
    );
    expect(diasApp).not.toBeNull();
    expect(diasExt).toBeCloseTo(diasApp as number, 6);
  });
});

// numeroYPrefijoDeId no se re-exporta del lado de la app (función
// privada ahí) — se prueba sola acá para que quede cubierta igual.
describe("numeroYPrefijoDeId", () => {
  it("separa el prefijo de país de los dígitos del id", () => {
    expect(numeroYPrefijoDeId("MCO64541261")).toEqual({ prefijo: "MCO", numero: 64541261 });
  });

  it("un id sin el patrón prefijo+dígitos -> null", () => {
    expect(numeroYPrefijoDeId("no-es-un-id")).toBeNull();
  });
});
