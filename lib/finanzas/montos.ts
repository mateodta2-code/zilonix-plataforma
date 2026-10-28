// Issue #127 — montos de la tabla maestra y de terceros. Postgres
// redondea en silencio un numeric(14,2) con más decimales (1.005 →
// 1.01), así que el rechazo de "más de 2 decimales" tiene que pasar
// acá, antes de llegar a la base. Los montos viajan como texto, igual
// que los devuelve Postgres para numeric: nunca por coma flotante.

export class MontoInvalidoError extends Error {
  constructor(campo: string) {
    super(`${campo}: tiene que ser un monto mayor o igual a 0, con hasta 2 decimales.`);
    this.name = "MontoInvalidoError";
  }
}

// numeric(14,2): hasta 12 enteros y 2 decimales.
const MONTO = /^\d{1,12}(\.\d{1,2})?$/;

// null/undefined/"" = vacío (sin dato). Cualquier otro valor tiene que
// ser un monto válido; "0" queda como "0" (un cero real).
export function validarMonto(valor: string | number | null | undefined, campo: string): string | null {
  if (valor === null || valor === undefined) return null;
  const texto = String(valor).trim();
  if (texto === "") return null;
  if (!MONTO.test(texto)) throw new MontoInvalidoError(campo);
  return texto;
}

export function esCero(monto: string): boolean {
  return Number(monto) === 0;
}
