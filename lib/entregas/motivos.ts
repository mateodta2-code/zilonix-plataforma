// Motivos de «No entregado». El servidor los valida otra vez: el formulario
// solo es comodidad (un POST directo no debe poder guardar un motivo vacío).
export const MOTIVOS_NO_ENTREGA = {
  no_estaba: "No estaba",
  direccion_errada: "Dirección errada",
  rechazo: "Rechazó el pedido",
  otro: "Otro",
} as const;

export type ClaveMotivo = keyof typeof MOTIVOS_NO_ENTREGA;

export function esClaveMotivo(valor: string): valor is ClaveMotivo {
  return Object.prototype.hasOwnProperty.call(MOTIVOS_NO_ENTREGA, valor);
}

// Devuelve el texto a guardar, o null si falta o es inválido. «Otro»
// exige una explicación escrita.
export function componerMotivo(clave: string, detalle: string): string | null {
  if (!esClaveMotivo(clave)) return null;
  const extra = detalle.trim().slice(0, 200);
  if (clave === "otro") return extra ? `Otro: ${extra}` : null;
  return extra ? `${MOTIVOS_NO_ENTREGA[clave]}: ${extra}` : MOTIVOS_NO_ENTREGA[clave];
}
