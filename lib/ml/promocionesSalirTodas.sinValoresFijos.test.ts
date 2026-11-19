import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// Multi-país (CLAUDE.md): nunca MCO, COP, es-CO ni "$" fijos — siempre
// formatearMoneda / formatearNumero / datosSitioMl con el sitio de la
// cuenta. Esta prueba vigila los archivos nuevos de «Dejar de participar
// en todas» (y la pantalla que los usa). Los patrones se arman por
// partes para que este archivo no se detecte a sí mismo.
const PROHIBIDOS = [new RegExp("M" + "CO"), new RegExp("\\b" + "C" + "OP\\b"), new RegExp("es-" + "CO"), /\$(?!\{)/];
const ARCHIVOS = ["lib/ml/promocionesSalir.ts", "lib/ml/promocionesSalirTodas.ts", "app/panel/promociones/PaginaPromocionesReal.tsx"];

describe("archivos de «Dejar de participar en todas» — sin MCO / COP / es-CO / «$» fijos", () => {
  for (const archivo of ARCHIVOS) {
    it(archivo, () => {
      const lineas = readFileSync(archivo, "utf8").split("\n");
      const hallazgos = lineas.flatMap((linea, i) => (PROHIBIDOS.some((p) => p.test(linea)) ? [`${archivo}:${i + 1}: ${linea.trim()}`] : []));
      expect(hallazgos).toEqual([]);
    });
  }
});
