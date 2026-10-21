"use server";

import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { listarEmpresasDeUsuario } from "@/lib/empresas";
import { obtenerOCrearUsuarioActual } from "@/lib/usuarios";
import { requierePermiso } from "@/lib/permisos";
import { obtenerItemConHilo, responderPregunta, responderMensajeVenta, responderReclamo, asignarOperador } from "@/lib/ml/bandeja";

async function contexto() {
  const usuario = await obtenerOCrearUsuarioActual();
  if (!usuario) redirect("/sign-in");
  const propias = await listarEmpresasDeUsuario(usuario.id);
  const empresaId = cookies().get("empresa_actual")?.value;
  const empresa = propias.find((e) => e.id === empresaId) ?? propias[0];
  if (!empresa) throw new Error("No se encontró tu empresa activa.");
  return { usuario, empresa };
}

export async function responderAction(itemId: string, formData: FormData) {
  const { usuario, empresa } = await contexto();
  await requierePermiso(usuario.id, empresa.id, "atencion", "modificar");

  const texto = String(formData.get("texto") ?? "").trim();
  if (!texto) throw new Error("Escribe una respuesta.");

  const resultado = await obtenerItemConHilo(empresa.id, itemId);
  if (!resultado) throw new Error("No se encontró el ítem.");
  const { item } = resultado;

  if (item.tipo === "pregunta") {
    await responderPregunta(empresa.id, item.cuentaMlId, item.externalId, texto);
  } else if (item.tipo === "mensaje") {
    if (!item.compradorId) throw new Error("No se encontró el comprador de este hilo.");
    await responderMensajeVenta(empresa.id, item.cuentaMlId, item.externalId, item.compradorId, texto);
  } else {
    await responderReclamo(empresa.id, item.cuentaMlId, item.externalId, texto);
  }

  redirect(`/panel/bandeja/${itemId}`);
}

export async function asignarAction(itemId: string, formData: FormData) {
  const { usuario, empresa } = await contexto();
  await requierePermiso(usuario.id, empresa.id, "atencion", "modificar");

  const operadorId = String(formData.get("operadorId") ?? "") || null;
  await asignarOperador(empresa.id, usuario.id, itemId, operadorId);
  redirect(`/panel/bandeja/${itemId}`);
}
