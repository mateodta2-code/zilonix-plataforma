"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { listarEmpresasDeUsuario } from "@/lib/empresas";
import { obtenerOCrearUsuarioActual } from "@/lib/usuarios";
import { requierePermiso } from "@/lib/permisos";
import { listarCuentasConectadas, obtenerCredenciales } from "@/lib/falabella/cuentas";
import { aplanarHojas, obtenerArbolCategorias, obtenerAtributosCategoria, type AtributoCategoria } from "@/lib/falabella/catalogo";
import { construirBorrador, type BorradorFalabella, type EntradaBorradorFalabella } from "@/lib/falabella/publicar-reglas";
import { consultarFeed, enviarImagenes, enviarProductCreate, BorradorConProblemasError, type EstadoFeed } from "@/lib/falabella/publicar";
import { FalabellaApiError, FalabellaNoDisponibleError } from "@/lib/falabella/cliente";

// Fases 1 y 2 de "Publicar en Falabella". Todo pasa por aquí (servidor): la
// API Key descifrada nunca llega al navegador.

const PATRON_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type Resultado<T> = { ok: true; datos: T } | { ok: false; error: string };

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

// Fase 2, paso crear: recalcula el borrador en el servidor (nunca se confía
// en uno armado por el navegador) y SOLO entonces envía. La aprobación de
// Mateo es la acción explícita de pulsar "Crear".
export async function crearEnFalabellaAction(cuentaId: string, entrada: Omit<EntradaBorradorFalabella, "ahora">): Promise<Resultado<{ feedId: string }>> {
  return envolver(async () => {
    const { cred } = await contexto("crear", cuentaId);
    return { feedId: await enviarProductCreate(cred, construirBorrador(entrada)) };
  });
}

export async function estadoFeedFalabellaAction(cuentaId: string, feedId: string): Promise<Resultado<EstadoFeed>> {
  return envolver(async () => {
    const { cred } = await contexto("consultar", cuentaId);
    return consultarFeed(cred, feedId);
  });
}

// Solo después de que el feed de ProductCreate terminó sin errores.
export async function enviarImagenesFalabellaAction(cuentaId: string, sku: string, imagenes: string[]): Promise<Resultado<{ feedId: string }>> {
  return envolver(async () => {
    const { cred } = await contexto("crear", cuentaId);
    const borrador = construirBorrador({ sku, titulo: "x", descripcion: "xxxxxx", modelo: "x", precioOferta: 1, stock: 0, categoriaId: 1, imagenes });
    return { feedId: await enviarImagenes(cred, sku, borrador.imagenes) };
  });
}
