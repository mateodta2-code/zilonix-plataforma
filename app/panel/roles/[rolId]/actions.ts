"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { listarEmpresasDeUsuario } from "@/lib/empresas";
import { obtenerOCrearUsuarioActual } from "@/lib/usuarios";
import {
  ACCIONES,
  MODULOS,
  codificarPermisos,
  decodificarPermisos,
  esPeligroso,
  obtenerRolDeEmpresa,
  reemplazarPermisosDeRol,
  type Permiso,
} from "@/lib/roles";
import { requierePermiso } from "@/lib/permisos";

function leerPermisosDelFormulario(formData: FormData): Permiso[] {
  const permisos: Permiso[] = [];
  for (const modulo of MODULOS) {
    for (const accion of ACCIONES) {
      const valor = String(formData.get(`permiso__${modulo}__${accion}`) ?? "no");
      if (valor === "todo" || valor === "propio") {
        permisos.push({ modulo, accion, alcance: valor });
      }
    }
  }
  return permisos;
}

async function empresaYPermisoDeQuienLlama(formData: FormData) {
  const usuario = await obtenerOCrearUsuarioActual();
  if (!usuario) redirect("/sign-in");

  const empresaId = cookies().get("empresa_actual")?.value;
  const propias = await listarEmpresasDeUsuario(usuario.id);
  const empresa = propias.find((e) => e.id === empresaId);
  if (!empresa) throw new Error("No se encontró tu empresa activa.");

  // Tarea 1.8 — ajustar permisos es "autorizar" en "configuracion".
  await requierePermiso(usuario.id, empresa.id, "configuracion", "autorizar");

  const rolId = String(formData.get("rolId") ?? "");
  if (!rolId) throw new Error("Falta el rol.");

  return { empresa, rolId, usuarioId: usuario.id };
}

// Tarea 1.8 — si el formulario agrega un permiso PELIGROSO que el rol
// no tenía antes, no se guarda directo: se manda a una pantalla de
// confirmación aparte (evidencia real de Effi: un permiso peligroso
// concedido sin aviso le dio a una "Vendedora" el poder de cambiar la
// numeración DIAN). Si no hay nada nuevo peligroso, se guarda de una.
export async function guardarPermisosAction(formData: FormData) {
  const { empresa, rolId, usuarioId } = await empresaYPermisoDeQuienLlama(formData);

  const rolActual = await obtenerRolDeEmpresa(empresa.id, rolId);
  if (!rolActual) throw new Error("Rol no encontrado en esta empresa.");

  const propuestos = leerPermisosDelFormulario(formData);
  const nuevosPeligrosos = propuestos.filter(
    (p) =>
      esPeligroso(p.modulo, p.accion) &&
      !rolActual.permisos.some((actual) => actual.modulo === p.modulo && actual.accion === p.accion)
  );

  if (nuevosPeligrosos.length > 0) {
    redirect(`/panel/roles/${rolId}/confirmar?pendiente=${encodeURIComponent(codificarPermisos(propuestos))}`);
  }

  await reemplazarPermisosDeRol(empresa.id, rolId, propuestos, usuarioId);
  revalidatePath(`/panel/roles/${rolId}`);
  redirect("/panel/roles");
}

// Segundo paso del flujo de confirmación: vuelve a exigir el mismo
// permiso (nunca confía en que "ya se mostró la pantalla antes" como
// si fuera el permiso real) y guarda tal cual lo que venía pendiente.
export async function confirmarPermisosAction(formData: FormData) {
  const { empresa, rolId, usuarioId } = await empresaYPermisoDeQuienLlama(formData);

  const pendiente = String(formData.get("pendiente") ?? "");
  const permisos = decodificarPermisos(pendiente);

  await reemplazarPermisosDeRol(empresa.id, rolId, permisos, usuarioId);
  revalidatePath(`/panel/roles/${rolId}`);
  redirect("/panel/roles");
}
