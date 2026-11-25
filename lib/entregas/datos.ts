// Issue #627 (Domi-1) — datos de entrega que el vendedor copia al asignar.
// Mercado Libre no se consulta acá (sin llamadas nuevas): la persona los
// escribe o pega desde la orden. Nunca se confía en espacios de más ni en
// campos vacíos: se recortan y se validan antes de tocar la base.
export type DatosEntrega = {
  receptorNombre: string;
  direccion: string;
  barrio: string | null;
  ciudad: string;
  telefono: string;
  nota: string | null;
};

export class DatosEntregaInvalidosError extends Error {
  constructor(mensaje: string) {
    super(mensaje);
    this.name = "DatosEntregaInvalidosError";
  }
}

const MAX = 300;

export function normalizarDatosEntrega(entrada: Partial<Record<keyof DatosEntrega, string | null | undefined>>): DatosEntrega {
  const limpio = (v: string | null | undefined) => (v ?? "").trim();
  const receptorNombre = limpio(entrada.receptorNombre);
  const direccion = limpio(entrada.direccion);
  const ciudad = limpio(entrada.ciudad);
  const telefono = limpio(entrada.telefono);
  const barrio = limpio(entrada.barrio) || null;
  const nota = limpio(entrada.nota) || null;
  if (!receptorNombre) throw new DatosEntregaInvalidosError("Falta el nombre de quien recibe.");
  if (!direccion) throw new DatosEntregaInvalidosError("Falta la dirección.");
  if (!ciudad) throw new DatosEntregaInvalidosError("Falta la ciudad.");
  if (!telefono) throw new DatosEntregaInvalidosError("Falta el teléfono.");
  if (telefono.replace(/\D/g, "").length < 7) throw new DatosEntregaInvalidosError("El teléfono no parece válido.");
  for (const v of [receptorNombre, direccion, ciudad, telefono, barrio ?? "", nota ?? ""]) {
    if (v.length > MAX) throw new DatosEntregaInvalidosError(`Cada dato admite hasta ${MAX} caracteres.`);
  }
  return { receptorNombre, direccion, barrio, ciudad, telefono, nota };
}
