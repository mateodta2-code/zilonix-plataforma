"use server";

import { revalidatePath } from "next/cache";
import { requiereSesionSuperadmin } from "@/lib/superadmin";
import { cambiarVisibilidad } from "@/lib/foro";

// Esconder / volver a mostrar una publicación del foro. requiereSuperadmin
// se pide acá y otra vez en cambiarVisibilidad (lib/foro.ts).
export async function cambiarVisibilidadAction(formData: FormData) {
  const usuario = { id: (await requiereSesionSuperadmin()).usuarioId };

  const tipo = formData.get("tipo") === "respuesta" ? "respuesta" : "pregunta";
  const id = String(formData.get("id") ?? "");
  const ocultar = formData.get("ocultar") === "1";

  await cambiarVisibilidad(usuario.id, tipo, id, ocultar);
  revalidatePath("/superadmin/foro");
  revalidatePath("/panel/foro");
}
