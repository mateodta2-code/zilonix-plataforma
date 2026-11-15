"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { obtenerOCrearUsuarioActual } from "@/lib/usuarios";
import { requiereSuperadmin } from "@/lib/superadmin";
import { cambiarVisibilidad } from "@/lib/foro";

// Esconder / volver a mostrar una publicación del foro. requiereSuperadmin
// se pide acá y otra vez en cambiarVisibilidad (lib/foro.ts).
export async function cambiarVisibilidadAction(formData: FormData) {
  const usuario = await obtenerOCrearUsuarioActual();
  if (!usuario) redirect("/sign-in");
  await requiereSuperadmin(usuario.id);

  const tipo = formData.get("tipo") === "respuesta" ? "respuesta" : "pregunta";
  const id = String(formData.get("id") ?? "");
  const ocultar = formData.get("ocultar") === "1";

  await cambiarVisibilidad(usuario.id, tipo, id, ocultar);
  revalidatePath("/superadmin/foro");
  revalidatePath("/panel/foro");
}
