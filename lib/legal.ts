// Z-MT-15 — borrador para revisión de un abogado. Estas cadenas son la
// versión que la casilla guarda en auditoría al crear la empresa
// (lib/empresas.ts). Si el texto cambia, cambia la cadena: si no, el
// registro diría que la persona aceptó un texto que ya no es el de la
// pantalla.
export const TERMINOS_VERSION = "2026-10-borrador";
export const PRIVACIDAD_VERSION = "2026-10-borrador";
export const QUE_VE_ZILONIX_VERSION = "2026-10-borrador";

export type VersionesAceptadas = {
  terminosVersion: string;
  privacidadVersion: string;
  queVeVersion: string;
};

// La casilla manda value="si" solo cuando la persona la marca. Sin
// marcar, el navegador no envía el campo. "on" es el valor que el
// navegador pondría si el input no trajera value="si": no cuenta,
// porque la Ley 1581 pide una autorización expresa, no un accidente
// del formulario.
export function consentimientoMarcado(valor: FormDataEntryValue | null): boolean {
  return valor === "si";
}

export function versionesAceptadasCompletas(v: VersionesAceptadas): boolean {
  return [v.terminosVersion, v.privacidadVersion, v.queVeVersion].every((x) => x.trim().length > 0);
}

// Frase corta para una persona (mismo criterio de la tarea 1.9: el
// detalle de auditoría no es un JSON). La fecha no va en la frase: la
// pone la columna `ts` al insertar la fila.
export function detalleDeAceptacion(v: VersionesAceptadas): string {
  return `Aceptó los términos (${v.terminosVersion}), la política de datos (${v.privacidadVersion}) y el aviso de qué ve Zilonix (${v.queVeVersion}).`;
}
