// Issue #422 (fase 4 de Finanzas) — categorías base de gastos. Cada
// empresa nace con estas (lib/empresas.ts) y las que ya existían las
// recibieron en la migración 0038_sembrar_categorias_gasto.sql — la
// prueba compara las dos listas para que no se separen.
export const CATEGORIAS_GASTO_BASE = [
  "Arriendo",
  "Nómina",
  "Empaques",
  "Contador",
  "Agencias y transportadoras",
  "Flex y domiciliarios",
  "Publicidad externa",
  "Servicios públicos",
  "Software y suscripciones",
  "Otros",
] as const;

export class CategoriaGastoInvalidaError extends Error {
  constructor(mensaje: string) {
    super(mensaje);
    this.name = "CategoriaGastoInvalidaError";
  }
}

// Mismo CHECK que categorias_gasto_nombre_valido: sin espacios a los
// lados, de 1 a 60 caracteres. Los espacios repetidos se colapsan para
// que "Servicios  públicos" no quede como otra categoría.
export function normalizarNombreCategoria(nombre: string): string {
  const limpio = nombre.trim().replace(/\s+/g, " ");
  if (!limpio) throw new CategoriaGastoInvalidaError("El nombre de la categoría es obligatorio.");
  if (limpio.length > 60) throw new CategoriaGastoInvalidaError("El nombre de la categoría puede tener hasta 60 caracteres.");
  return limpio;
}
