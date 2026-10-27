import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { celdaConDelta, conSigno } from "./formato";

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
