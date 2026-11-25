// Posventa-Mensajes (Refs #645) — qué receptor y qué acción de ML hacen
// falta para escribir en un reclamo. Puro (sin imports del servidor) para
// poder usarlo también en el navegador.
export type RolReceptorReclamo = "complainant" | "mediator";

// Etapa claim → complainant; etapa dispute → mediator.
export function receptorYAccion(etapa: string | null): { receptor: RolReceptorReclamo; accion: string } {
  return etapa === "dispute"
    ? { receptor: "mediator", accion: "send_message_to_mediator" }
    : { receptor: "complainant", accion: "send_message_to_complainant" };
}

// Solo si ML se lo habilita al vendedor (respondent).
export function puedeEscribirEnReclamo(etapa: string | null, accionesVendedor: string[]): boolean {
  return accionesVendedor.includes(receptorYAccion(etapa).accion);
}
