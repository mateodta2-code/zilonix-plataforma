import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// Multi-país: ningún archivo del módulo Optimización escribe un sitio,
// moneda, idioma ni símbolo fijos. El sitio, la moneda y el idioma salen
// SIEMPRE de la cuenta (obtenerSitioDeCuenta) vía formatearMoneda /
// formatearNumero.
const ARCHIVOS = [
  "lib/ml/optimizacion.ts",
  "lib/ml/optimizacion-datos.ts",
  "app/panel/optimizacion/page.tsx",
  "app/panel/optimizacion/Celdas.tsx",
  "app/panel/optimizacion/FilaOptimizacion.tsx",
  "app/panel/optimizacion/ToastOptimizacion.tsx",
  "app/panel/optimizacion/actions.ts",
];

const PROHIBIDOS: [string, RegExp][] = [
  ["MCO", /\bMCO\b/],
  ["COP", /\bCOP\b/],
  ["es-CO", /es-CO/],
  ['"$" fijo', /["'`]\$["'`]|\$\s*\{?\s*valor|toLocaleString\(/],
];

// Solo el código nuevo de cliente.ts (después de su marca) se revisa.
function codigoNuevoDeCliente(): string {
  const todo = readFileSync("lib/ml/cliente.ts", "utf8");
  return todo.slice(todo.indexOf("Módulo Optimización, Parte 1"));
}

describe("Optimización — sin país, moneda ni símbolo fijos", () => {
  const fuentes: [string, string][] = [...ARCHIVOS.map((a): [string, string] => [a, readFileSync(a, "utf8")]), ["lib/ml/cliente.ts (Optimización)", codigoNuevoDeCliente()]];
  for (const [nombre, texto] of fuentes) {
    it(nombre, () => {
      // Se ignoran los comentarios de línea: pueden nombrar un país como ejemplo.
      const codigo = texto
        .split("\n")
        .filter((l) => !l.trim().startsWith("//"))
        .join("\n");
      for (const [etiqueta, patron] of PROHIBIDOS) expect(codigo, `${nombre} contiene ${etiqueta}`).not.toMatch(patron);
    });
  }
});
