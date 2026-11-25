import { cookies } from "next/headers";
import { dbComoEmpresa } from "@/db/empresa-context";
import { listarEmpresasDeUsuario } from "@/lib/empresas";
import { registrarAuditoria } from "@/lib/auditoria";
import { creaContador, superaLimite } from "@/lib/limite-peticiones";
import { listarCuentasConectadas } from "@/lib/ml/cuentas";
import { SinPermisoError } from "@/lib/permisos";
import { obtenerOCrearUsuarioActual } from "@/lib/usuarios";
import { esUuid } from "@/lib/validacion";
import type { ArchivoSubida } from "@/lib/ml/mensajesPosventaEnvio";
import { MAX_ADJUNTOS_POR_MENSAJE } from "@/lib/posventa/adjuntos";

// Posventa-Mensajes (Refs #645) — puerta común de las acciones de servidor
// de mensajes y reclamos: sesión, empresa actual, permiso «ventas
// modificar» y cuenta de ML de ESTA empresa (RLS). Nunca se confía en el
// cuentaId que llega del navegador sin verificarlo.

export type ContextoPosventa = {
  usuarioId: string;
  empresaId: string;
  cuenta: { id: string; cuentaIdExterna: string; siteId: string | null; nickname: string };
};
export type ResultadoContexto = { ok: true; ctx: ContextoPosventa } | { ok: false; mensaje: string };

const PERIODO_MS = 60_000;
const contadorEnvioEmpresa = creaContador();
const contadorIAEmpresa = creaContador();
const contadorIAUsuario = creaContador();

export function superaLimiteEnvio(empresaId: string): boolean {
  return superaLimite(contadorEnvioEmpresa, empresaId, 20, PERIODO_MS);
}
// Sugerencias de IA: 10 por minuto por empresa y 10 por minuto por usuario.
export function superaLimiteIA(empresaId: string, usuarioId: string): boolean {
  const empresa = superaLimite(contadorIAEmpresa, empresaId, 10, PERIODO_MS);
  const usuario = superaLimite(contadorIAUsuario, usuarioId, 10, PERIODO_MS);
  return empresa || usuario;
}

// `verificarPermiso` lo pasa cada acción (con su propio requierePermiso
// "ventas"/"modificar" a la vista, que es lo que revisa el CI).
export async function resolverContextoPosventa(cuentaId: unknown, verificarPermiso: (usuarioId: string, empresaId: string) => Promise<unknown>): Promise<ResultadoContexto> {
  const usuario = await obtenerOCrearUsuarioActual();
  if (!usuario) return { ok: false, mensaje: "Tu sesión terminó. Vuelve a entrar." };
  const propias = await listarEmpresasDeUsuario(usuario.id);
  const empresaIdCookie = cookies().get("empresa_actual")?.value;
  const empresa = propias.find((e) => e.id === empresaIdCookie) ?? propias[0];
  if (!empresa) return { ok: false, mensaje: "No hay una empresa activa." };
  try {
    await verificarPermiso(usuario.id, empresa.id);
  } catch (error) {
    if (error instanceof SinPermisoError) return { ok: false, mensaje: "No tienes permiso para responder en Posventa." };
    throw error;
  }
  if (typeof cuentaId !== "string" || !esUuid(cuentaId)) return { ok: false, mensaje: "Cuenta no encontrada." };
  const cuenta = (await listarCuentasConectadas(empresa.id)).find((c) => c.id === cuentaId);
  if (!cuenta || cuenta.desconectadaTs) return { ok: false, mensaje: "La cuenta de Mercado Libre no está disponible. Reconéctala." };
  return { ok: true, ctx: { usuarioId: usuario.id, empresaId: empresa.id, cuenta: { id: cuenta.id, cuentaIdExterna: cuenta.cuentaIdExterna, siteId: cuenta.siteId, nickname: cuenta.nickname } } };
}

// Lee los archivos del formulario y los pasa a bytes (solo en memoria).
export async function archivosDeFormulario(formData: FormData): Promise<ArchivoSubida[] | null> {
  const archivos = formData.getAll("archivos").filter((a): a is File => typeof a !== "string" && a.size > 0);
  if (archivos.length > MAX_ADJUNTOS_POR_MENSAJE) return null;
  return Promise.all(archivos.map(async (a) => ({ nombre: a.name, tipo: a.type, bytes: await a.arrayBuffer() })));
}

// Auditoría SIN el texto del mensaje: solo cuenta, venta/reclamo y cuántos adjuntos.
export async function auditarMensaje(ctx: ContextoPosventa, accion: "posventa.mensaje_enviado" | "reclamo.mensaje_enviado", entidadId: string, adjuntos: number): Promise<void> {
  const que = accion === "reclamo.mensaje_enviado" ? "reclamo" : "venta";
  await dbComoEmpresa(ctx.empresaId, (tx) =>
    registrarAuditoria(tx, {
      empresaId: ctx.empresaId,
      usuarioId: ctx.usuarioId,
      actorTipo: "persona",
      accion,
      entidad: accion === "reclamo.mensaje_enviado" ? "reclamo_ml" : "venta_ml",
      entidadId,
      detalle: `Envió un mensaje en el ${que} ${entidadId} de ${ctx.cuenta.nickname} (${adjuntos} ${adjuntos === 1 ? "adjunto" : "adjuntos"}).`,
    })
  );
}
