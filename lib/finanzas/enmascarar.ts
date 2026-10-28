// Issue #125 — el documento del titular, el correo y el WhatsApp de los
// avisos no pueden quedar en la bitácora ni en un log en claro. La
// tabla sí guarda el dato completo (hace falta para el único y para
// mandar el aviso); el rastro de auditoría no.

const VISIBLES = 4;

function colaVisible(valor: string): string {
  const limpio = valor.trim();
  // Con 4 o menos caracteres, mostrar la cola sería mostrar el dato
  // entero. Se oculta todo.
  if (limpio.length <= VISIBLES) return "****";
  return `***${limpio.slice(-VISIBLES)}`;
}

// Últimos 4 dígitos. Se tiran puntos, guiones y espacios antes, para
// que "900.123.456-7" no deje el número armado en la cola.
export function enmascararDocumento(documento: string): string {
  return colaVisible(documento.replace(/\D/g, ""));
}

export function enmascararWhatsapp(numero: string): string {
  return enmascararDocumento(numero);
}

export function enmascararCorreo(correo: string): string {
  return colaVisible(correo.trim().toLowerCase());
}
