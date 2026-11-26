import { validarImagenesTicket } from "./imagenes";
import { SoporteError } from "./validacion";

// Lee y valida las capturas que manda un formulario de ticket (campo
// «imagen», ya reducidas a JPEG en el navegador). Lo usan las acciones del
// vendedor y del superadmin, ANTES de subir nada.
export async function leerImagenesTicket(datos: FormData | undefined): Promise<Uint8Array[]> {
  const archivos = (datos?.getAll?.("imagen") ?? []).filter((v): v is File => v instanceof File && v.size > 0);
  const bytes = await Promise.all(archivos.map(async (a) => new Uint8Array(await a.arrayBuffer())));
  const problema = validarImagenesTicket(bytes);
  if (problema) throw new SoporteError(problema);
  return bytes;
}
