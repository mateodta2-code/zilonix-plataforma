"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { listarEmpresasDeUsuario } from "@/lib/empresas";
import { obtenerOCrearUsuarioActual } from "@/lib/usuarios";
import { requierePermiso } from "@/lib/permisos";
import { listarCuentasConectadas, obtenerCredenciales } from "@/lib/falabella/cuentas";
import { aplanarHojas, obtenerArbolCategorias, obtenerAtributosCategoria, type AtributoCategoria } from "@/lib/falabella/catalogo";
import { construirBorrador, type BorradorFalabella, type EntradaBorradorFalabella } from "@/lib/falabella/publicar-reglas";
import type { ProductoFalabella } from "@/lib/falabella/producto";
import { BorradorConProblemasError } from "@/lib/falabella/publicar";
import { aprobarYCrear, avanzar, corregirRechazado, descartar, estadoRealPublicacion } from "@/lib/falabella/publicaciones";
import { obtenerConexionIAParaModulo } from "@/lib/ia/conexion";
import { llamarIA } from "@/lib/ia/proveedores";
import { leerRespuestaCategorias, preseleccionarCategorias, promptCategoriaFalabella } from "@/lib/falabella/categorias-sugeridas";
import { FalabellaApiError, FalabellaNoDisponibleError } from "@/lib/falabella/cliente";

// Fases 1 y 2 de "Publicar en Falabella". Todo pasa por aquí (servidor): la
// API Key descifrada nunca llega al navegador.

const PATRON_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type Resultado<T> = { ok: true; datos: T } | { ok: false; error: string };

async function empresaConPermiso(permiso: "consultar" | "crear" | "modificar", id: string): Promise<string> {
  const usuario = await obtenerOCrearUsuarioActual();
  if (!usuario) redirect("/sign-in");
  const propias = await listarEmpresasDeUsuario(usuario.id);
  const empresaId = cookies().get("empresa_actual")?.value;
  const empresa = propias.find((e) => e.id === empresaId) ?? propias[0];
  if (!empresa) throw new Error("No se encontró tu empresa activa.");
  await requierePermiso(usuario.id, empresa.id, "inventario", permiso);
  if (!PATRON_UUID.test(id)) throw new Error("id inválido.");
  return empresa.id;
}

async function contexto(permiso: "consultar" | "crear", cuentaId: string) {
  const usuario = await obtenerOCrearUsuarioActual();
  if (!usuario) redirect("/sign-in");
  const propias = await listarEmpresasDeUsuario(usuario.id);
  const empresaId = cookies().get("empresa_actual")?.value;
  const empresa = propias.find((e) => e.id === empresaId) ?? propias[0];
  if (!empresa) throw new Error("No se encontró tu empresa activa.");
  await requierePermiso(usuario.id, empresa.id, "inventario", permiso);
  if (!PATRON_UUID.test(cuentaId)) throw new Error("Cuenta de Falabella inválida.");
  return { empresaId: empresa.id, cred: await obtenerCredenciales(empresa.id, cuentaId) };
}

// Mensajes en español y sin texto crudo de la API de Falabella más allá del
// motivo que ella misma da por campo (ya filtrado en cliente.ts).
async function envolver<T>(fn: () => Promise<T>): Promise<Resultado<T>> {
  try {
    return { ok: true, datos: await fn() };
  } catch (error) {
    if (error instanceof BorradorConProblemasError) return { ok: false, error: error.message };
    if (error instanceof FalabellaApiError) return { ok: false, error: `Falabella rechazó la solicitud: ${error.message}` };
    if (error instanceof FalabellaNoDisponibleError) return { ok: false, error: "Falabella no respondió bien. Intenta de nuevo en un momento." };
    if (error instanceof Error && error.message) return { ok: false, error: error.message };
    return { ok: false, error: "No se pudo completar la acción con Falabella." };
  }
}

export async function cuentasFalabellaParaPublicar() {
  const usuario = await obtenerOCrearUsuarioActual();
  if (!usuario) redirect("/sign-in");
  const propias = await listarEmpresasDeUsuario(usuario.id);
  const empresaId = cookies().get("empresa_actual")?.value;
  const empresa = propias.find((e) => e.id === empresaId) ?? propias[0];
  if (!empresa) throw new Error("No se encontró tu empresa activa.");
  await requierePermiso(usuario.id, empresa.id, "inventario", "consultar");
  return (await listarCuentasConectadas(empresa.id)).filter((c) => !c.desconectadaTs).map((c) => ({ id: c.id, nickname: c.nickname }));
}

// Fase 1 (solo lectura): categorías hoja donde se puede publicar.
export async function categoriasFalabellaAction(cuentaId: string): Promise<Resultado<{ id: number; ruta: string }[]>> {
  return envolver(async () => {
    const { cred } = await contexto("consultar", cuentaId);
    return aplanarHojas(await obtenerArbolCategorias(cred));
  });
}

export async function atributosFalabellaAction(cuentaId: string, categoriaId: number): Promise<Resultado<AtributoCategoria[]>> {
  return envolver(async () => {
    const { cred } = await contexto("consultar", cuentaId);
    return obtenerAtributosCategoria(cred, categoriaId);
  });
}

// Fase 2, paso borrador: aplica las reglas de Mateo y NO toca Falabella.
export async function borradorFalabellaAction(cuentaId: string, entrada: Omit<EntradaBorradorFalabella, "ahora">): Promise<Resultado<BorradorFalabella>> {
  return envolver(async () => {
    await contexto("consultar", cuentaId);
    return construirBorrador(entrada);
  });
}

// Aprobar el borrador = crear en Falabella. El borrador ya quedó guardado y
// recalculado en el servidor al enviar el formulario; aquí nunca se acepta
// uno armado por el navegador.
export async function aprobarFalabellaAction(id: string): Promise<Resultado<null>> {
  return envolver(async () => {
    const empresaId = await empresaConPermiso("crear", id);
    await aprobarYCrear(empresaId, id);
    return null;
  });
}

// Un paso de seguimiento del feed (la pantalla lo llama cada pocos segundos
// solo mientras hay publicaciones en proceso).
export async function avanzarFalabellaAction(id: string): Promise<Resultado<null>> {
  return envolver(async () => {
    const empresaId = await empresaConPermiso("consultar", id);
    await avanzar(empresaId, id);
    return null;
  });
}

// Solo borra la fila local, nunca algo ya creado en Falabella.
export async function descartarFalabellaAction(id: string): Promise<Resultado<null>> {
  return envolver(async () => {
    const empresaId = await empresaConPermiso("modificar", id);
    await descartar(empresaId, id);
    return null;
  });
}

// Llena los campos que Falabella pidió en un rechazo y devuelve la
// publicación a borrador (se vuelve a aprobar a mano).
export async function corregirFalabellaAction(id: string, atributos: Record<string, string>): Promise<Resultado<null>> {
  return envolver(async () => {
    const empresaId = await empresaConPermiso("modificar", id);
    const limpios: Record<string, string> = {};
    for (const [nombre, valor] of Object.entries(atributos)) {
      if (!/^[A-Za-z][A-Za-z0-9_]{0,60}$/.test(nombre) || typeof valor !== "string") continue;
      if (valor.trim()) limpios[nombre] = valor.trim().slice(0, 500);
    }
    await corregirRechazado(empresaId, id, limpios);
    return null;
  });
}

// Botón «Recomendar categoría». Falabella no tiene sugerencia por API:
// se preselecciona por palabras del título y, si la empresa conectó una IA
// para «Publicaciones», ella elige las 3 mejores entre esas opciones.
export async function recomendarCategoriaFalabellaAction(cuentaId: string, titulo: string): Promise<Resultado<{ categorias: { id: number; ruta: string }[]; conIA: boolean }>> {
  return envolver(async () => {
    const { empresaId, cred } = await contexto("consultar", cuentaId);
    if (!titulo.trim()) throw new Error("Escribe primero el título para poder recomendar una categoría.");
    const candidatas = preseleccionarCategorias(aplanarHojas(await obtenerArbolCategorias(cred)), titulo, 40);
    if (candidatas.length === 0) return { categorias: [], conIA: false };
    const conexion = await obtenerConexionIAParaModulo(empresaId, "publicaciones");
    if (conexion) {
      try {
        const elegidas = leerRespuestaCategorias(await llamarIA(conexion, promptCategoriaFalabella(titulo, candidatas), { maxTokens: 200 }), candidatas);
        if (elegidas.length > 0) return { categorias: elegidas, conIA: true };
      } catch {
        // Sin IA o falla: se cae a la preselección por palabras.
      }
    }
    return { categorias: candidatas.slice(0, 5), conIA: false };
  });
}

// Trae de Falabella el link y el estado real de lo ya creado (solo lectura).
export async function estadoRealFalabellaAction(id: string): Promise<Resultado<ProductoFalabella | null>> {
  return envolver(async () => {
    const empresaId = await empresaConPermiso("consultar", id);
    return estadoRealPublicacion(empresaId, id);
  });
}
