// Extraído de lib/costos-sku.ts (rama feat-promociones-aprobacion) —
// función pura, sin ningún import de db/, para que lib/ml/cliente.ts
// (que hoy no toca Postgres) pueda normalizar el SKU que lee de
// Mercado Libre con el MISMO criterio que usa la importación/edición
// manual en Finanzas, sin arrastrar DATABASE_URL_APP a un archivo que
// no lo necesita — lib/costos-sku.ts reexporta esto para que sus
// propios llamadores (Finanzas) no tengan que cambiar nada.
export class SkuCodigoInvalidoError extends Error {
  constructor() {
    super("El código de SKU no puede estar vacío.");
    this.name = "SkuCodigoInvalidoError";
  }
}

// La llave de la maestra. Mismo criterio en los dos lados del cruce:
// el SKU de la publicación de ML y el de la importación.
export function normalizarSkuCodigo(codigo: string): string {
  const normalizado = codigo.trim().toUpperCase();
  if (!normalizado) throw new SkuCodigoInvalidoError();
  return normalizado;
}
