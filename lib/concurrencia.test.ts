import { describe, expect, it } from "vitest";
import { conConcurrenciaLimitada } from "./concurrencia";

function esperar(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

describe("conConcurrenciaLimitada", () => {
  it("devuelve los resultados en el MISMO orden que los items de entrada, sin importar cuál tarea termine primero", async () => {
    const items = [30, 10, 20, 5];
    const resultado = await conConcurrenciaLimitada(items, 2, async (ms) => {
      await esperar(ms);
      return ms;
    });
    expect(resultado).toEqual([30, 10, 20, 5]);
  });

  it("nunca corre más de `limite` tareas al mismo tiempo", async () => {
    const items = [1, 2, 3, 4, 5, 6];
    let enCurso = 0;
    let maximoObservado = 0;
    await conConcurrenciaLimitada(items, 2, async () => {
      enCurso += 1;
      maximoObservado = Math.max(maximoObservado, enCurso);
      await esperar(5);
      enCurso -= 1;
      return null;
    });
    expect(maximoObservado).toBeLessThanOrEqual(2);
  });

  it("un trabajador libre toma la SIGUIENTE tarea apenas termina la suya (nunca espera a que termine toda la tanda)", async () => {
    const orden: number[] = [];
    // item 0 tarda mucho, items 1-3 son rápidos — con concurrencia 2,
    // el trabajador que agarra el item rápido debería poder encadenar
    // 1, 2 y 3 mientras el otro sigue ocupado con el 0.
    await conConcurrenciaLimitada([0, 1, 2, 3], 2, async (item) => {
      await esperar(item === 0 ? 30 : 5);
      orden.push(item);
      return item;
    });
    expect(orden[orden.length - 1]).toBe(0); // el lento termina último
    expect(orden.slice(0, 3).sort()).toEqual([1, 2, 3]); // los 3 rápidos ya terminaron antes
  });

  it("array vacío: [] de inmediato, nunca lanza", async () => {
    const resultado = await conConcurrenciaLimitada<number, number>([], 3, async (n) => n);
    expect(resultado).toEqual([]);
  });

  it("limite mayor que la cantidad de items: corre todos en paralelo igual, sin romper", async () => {
    const resultado = await conConcurrenciaLimitada([1, 2], 10, async (n) => n * 2);
    expect(resultado).toEqual([2, 4]);
  });

  it("limite 0 o negativo: se trata como 1 (nunca 0 trabajadores, que colgaría para siempre)", async () => {
    const resultado = await conConcurrenciaLimitada([1, 2], 0, async (n) => n);
    expect(resultado).toEqual([1, 2]);
  });

  it("si una tarea rechaza, conConcurrenciaLimitada rechaza — tolerar fallas por item es responsabilidad de la tarea, no de este helper", async () => {
    await expect(
      conConcurrenciaLimitada([1, 2, 3], 2, async (n) => {
        if (n === 2) throw new Error("falló la tarea 2");
        return n;
      })
    ).rejects.toThrow("falló la tarea 2");
  });
});
