// Validación pura de los datos de entrega (sin base de datos, para poder
// probarla sin Postgres).
export class EntregaInvalidaError extends Error {}

export type DatosEntrega = {
  receptorNombre: string;
  direccion: string;
  barrio: string;
  ciudad: string;
  telefono: string;
  nota: string;
};


const MAX_CAMPO = 300;

// Recorta y exige lo mínimo para que el domiciliario pueda llegar:
// nombre, dirección, ciudad y teléfono. Barrio y nota son opcionales.
export function validarDatosEntrega(d: DatosEntrega): DatosEntrega {
  const limpio: DatosEntrega = {
    receptorNombre: d.receptorNombre.trim(),
    direccion: d.direccion.trim(),
    barrio: d.barrio.trim(),
    ciudad: d.ciudad.trim(),
    telefono: d.telefono.trim(),
    nota: d.nota.trim(),
  };
  if (!limpio.receptorNombre) throw new EntregaInvalidaError("Escribe el nombre de quien recibe.");
  if (!limpio.direccion) throw new EntregaInvalidaError("Escribe la dirección de entrega.");
  if (!limpio.ciudad) throw new EntregaInvalidaError("Escribe la ciudad.");
  if (!limpio.telefono) throw new EntregaInvalidaError("Escribe el teléfono de contacto.");
  for (const valor of Object.values(limpio)) {
    if (valor.length > MAX_CAMPO) throw new EntregaInvalidaError(`Cada dato admite hasta ${MAX_CAMPO} caracteres.`);
  }
  return limpio;
}

