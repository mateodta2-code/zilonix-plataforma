// Rama feat-investigacion-buscar-por-foto — la foto buscada vive SOLO en
// la memoria de esta pestaña (una variable del módulo): nunca
// sessionStorage, localStorage, IndexedDB ni el servidor. Sirve para que
// BuscarPorFoto.tsx (que la elige) y ComparacionFoto.tsx (que la compara
// con el listado) la compartan sin guardarla en ningún lado. Si la
// persona recarga la página, se pierde la comparación; la búsqueda
// guardada (sesiones de listadoCliente.ts) sigue.
export type FotoBusqueda = {
  termino: string; // el término con el que se navegó (para saber a qué búsqueda pertenece)
  pais: string;
  base64: string; // JPEG ya reducido en el navegador
};

let actual: FotoBusqueda | null = null;
const oyentes = new Set<() => void>();

export function normalizarTerminoFoto(termino: string): string {
  return termino.trim().replace(/\s+/g, " ").toLowerCase();
}

export function guardarFotoBusqueda(foto: FotoBusqueda | null): void {
  actual = foto;
  oyentes.forEach((f) => f());
}

export function obtenerFotoBusqueda(): FotoBusqueda | null {
  return actual;
}

// Solo devuelve la foto si es de ESTA búsqueda (otro término = otra foto).
export function fotoDeTermino(termino: string): FotoBusqueda | null {
  return actual && normalizarTerminoFoto(actual.termino) === normalizarTerminoFoto(termino) ? actual : null;
}

export function suscribirFotoBusqueda(oyente: () => void): () => void {
  oyentes.add(oyente);
  return () => oyentes.delete(oyente);
}
