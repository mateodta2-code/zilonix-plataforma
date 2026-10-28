import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { celdaConDelta, conSigno, vendidosAproxParaFila } from "./formato";

const dinero = (n: number) => `$${n.toLocaleString("es-CO")}`;
const numeroPlano = (n: number) => n.toLocaleString("es-CO");

function html(nodo: React.ReactNode): string {
  return renderToStaticMarkup(nodo as React.ReactElement);
}

describe("celdaConDelta — issue #262 (revisión de Mateo, punto 3)", () => {
  it("sin foto anterior: solo el valor, sin paréntesis", () => {
    expect(html(celdaConDelta(939900, null, dinero))).toBe("$939.900");
  });

  // Bug real reportado: "$939.900 ($0)" en el Colchón Relax — el
  // precio de hoy es IGUAL al de ayer (delta 0), no "bajó a cero".
  it('delta 0 (el precio no cambió): nunca muestra "($0)" — solo el valor, sin paréntesis', () => {
    const resultado = html(celdaConDelta(939900, 939900, dinero));
    expect(resultado).toBe("$939.900");
    expect(resultado).not.toContain("$0");
  });

  it("delta positivo: valor + (+delta), con el signo", () => {
    const resultado = html(celdaConDelta(100, 90, numeroPlano));
    expect(resultado).toContain("100");
    expect(resultado).toContain("(+10)");
  });

  it("delta negativo: valor + (-delta)", () => {
    const resultado = html(celdaConDelta(90, 100, numeroPlano));
    expect(resultado).toContain("90");
    expect(resultado).toContain("(-10)");
  });

  it("actual null -> '—', nunca intenta calcular un delta", () => {
    expect(html(celdaConDelta(null, 100, numeroPlano))).toBe("—");
  });
});

describe("conSigno — issue #262 (sigue mostrando 0 cuando se lo llama directo, ej. Ventas ~30D real)", () => {
  it("0 muestra el valor sin signo (uso directo, fuera de celdaConDelta, SÍ es información real)", () => {
    expect(conSigno(0, numeroPlano)).toBe("0");
  });

  it("positivo y negativo llevan el signo explícito", () => {
    expect(conSigno(5, numeroPlano)).toBe("+5");
    expect(conSigno(-5, numeroPlano)).toBe("-5");
  });
});

// Issue #251 (fix "aproximados siempre visibles") — bug real probado
// en staging: antes, `esFull == null` (la mayoría de los seguimientos
// nuevos) descartaba el estimado ENTERO. Ahora asume el factor "no
// Full" (1.55) en vez de no estimar nada.
describe("vendidosAproxParaFila — issue #251 (fix 'aproximados siempre visibles')", () => {
  it("esFull null (desconocido): estima con el factor 'no Full' (1.55), nunca descarta el estimado", () => {
    const resultado = vendidosAproxParaFila("producto", 100, false, null);
    expect(resultado).toBeCloseTo(155); // 100 × 1.55
  });

  it("esFull true (confirmado): usa el factor Full (2.2)", () => {
    const resultado = vendidosAproxParaFila("producto", 100, false, true);
    expect(resultado).toBeCloseTo(220);
  });

  it("esFull false (confirmado 'no Full'): mismo factor que 'desconocido' (1.55) — ya era el comportamiento correcto", () => {
    const resultado = vendidosAproxParaFila("producto", 100, false, false);
    expect(resultado).toBeCloseTo(155);
  });

  it("vendidos exacto (confirmado por la API): se usa tal cual, sin multiplicar, con o sin esFull", () => {
    expect(vendidosAproxParaFila("producto", 40, true, null)).toBe(40);
  });

  it("tipo 'tienda' (no aplica este estimado) o sin vendidos: null", () => {
    expect(vendidosAproxParaFila("tienda", 100, false, true)).toBeNull();
    expect(vendidosAproxParaFila("producto", null, false, true)).toBeNull();
  });
});
