// Rama feat-publicar-clip — necesita "buscar en TODAS las cuentas
// conectadas de la empresa en paralelo, con un tope de concurrencia"
// (punto 3) y "subir a cada cuenta marcada, de forma secuencial o con
// concurrencia de 2" (punto 4). Ningún helper de este tipo existía
// todavía en el repo — genérico a propósito (no sabe nada de Mercado
// Libre ni de cuentas), así sirve para los 2 casos sin duplicar la
// lógica del pool de trabajadores.
//
// Patrón real: un pool fijo de `limite` "trabajadores" que van tomando
// el SIGUIENTE índice disponible (nunca una tanda de `limite` a la vez
// esperando a que termine toda la tanda para arrancar la siguiente —
// eso dejaría a los más rápidos esperando sin trabajo mientras uno
// lento termina).
//
// A propósito, esta función NUNCA atrapa un error de `tarea` por su
// cuenta: si `tarea` rechaza, todo `conConcurrenciaLimitada` rechaza
// (igual que `Promise.all`) — "una cuenta falla, las demás siguen" es
// responsabilidad de CADA `tarea` (atrapar su propio error y devolver
// un resultado con el error adentro, nunca dejar que se le escape la
// excepción) — nunca de este helper genérico, que no sabe nada del
// negocio de cada tarea para decidir qué es "tolerable".
export async function conConcurrenciaLimitada<T, R>(items: T[], limite: number, tarea: (item: T, indice: number) => Promise<R>): Promise<R[]> {
  const resultados: R[] = new Array(items.length);
  let siguiente = 0;

  async function trabajador(): Promise<void> {
    while (true) {
      const indice = siguiente;
      siguiente += 1;
      if (indice >= items.length) return;
      resultados[indice] = await tarea(items[indice], indice);
    }
  }

  const tope = Math.max(1, Math.min(limite, items.length));
  await Promise.all(Array.from({ length: tope }, () => trabajador()));
  return resultados;
}
