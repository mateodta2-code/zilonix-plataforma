import { clerkClient } from "@clerk/nextjs/server";

// Versión de los Términos y la Política que la persona aceptó. Se sube
// cuando cambie el texto legal, para poder saber quién aceptó cuál.
export const VERSION_TERMINOS = "2026-11-23";

export const MENSAJE_ACEPTACION_REQUERIDA = "Debes aceptar los Términos y la Política de privacidad para continuar.";

// Pura: la validación real va en el servidor, el `required` del
// navegador no es una garantía (se puede forzar el envío).
export function validarAceptacionTerminos(formData: FormData): boolean {
  return formData.get("acepta_terminos") === "si";
}

// Guarda la aceptación en privateMetadata (solo servidor) sin borrar lo
// que ya hubiera en ella. Sin columna nueva en la base.
export async function registrarAceptacionTerminos(clerkUserId: string): Promise<void> {
  const cliente = await clerkClient();
  const usuario = await cliente.users.getUser(clerkUserId);
  await cliente.users.updateUserMetadata(clerkUserId, {
    privateMetadata: {
      ...usuario.privateMetadata,
      terminosAceptados: { version: VERSION_TERMINOS, fecha: new Date().toISOString() },
    },
  });
}
