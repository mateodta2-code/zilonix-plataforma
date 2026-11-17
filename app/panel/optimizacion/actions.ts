"use server";

import { cookies } from "next/headers";
import { dbComoEmpresa } from "@/db/empresa-context";
import { registrarAuditoria } from "@/lib/auditoria";
import { listarEmpresasDeUsuario } from "@/lib/empresas";
import { PATRON_ID_PRODUCTO_O_ITEM } from "@/lib/ml/cliente";
import { cambiarEstadoItemMl } from "@/lib/ml/estado-item";
import { requierePermiso, SinPermisoError } from "@/lib/permisos";
import { obtenerOCrearUsuarioActual } from "@/lib/usuarios";

const PATRON_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type ResultadoCambioEstado = { ok: true; status: string } | { ok: false; mensaje: string };

// Pausar / activar una publicación desde Optimización. Exige
// "inventario","modificar" (el listado solo pide "consultar") y reutiliza
// cambiarEstadoItemMl: su mensaje amigable cuando Mercado Libre todavía
// está revisando la publicación se devuelve TAL CUAL, para el aviso.
export async function cambiarEstadoPublicacionAction(entrada: { cuentaId: string; itemId: string; activar: boolean }): Promise<ResultadoCambioEstado> {
  const usuario = await obtenerOCrearUsuarioActual();
  if (!usuario) return { ok: false, mensaje: "Tu sesión terminó. Vuelve a entrar." };

  const propias = await listarEmpresasDeUsuario(usuario.id);
  const empresaId = cookies().get("empresa_actual")?.value;
  const empresa = propias.find((e) => e.id === empresaId) ?? propias[0];
  if (!empresa) return { ok: false, mensaje: "No se encontró tu empresa activa." };

  try {
    await requierePermiso(usuario.id, empresa.id, "inventario", "modificar");
  } catch (error) {
    if (error instanceof SinPermisoError) return { ok: false, mensaje: "Tu rol no puede pausar ni activar publicaciones." };
    throw error;
  }

  if (typeof entrada.cuentaId !== "string" || !PATRON_UUID.test(entrada.cuentaId) || typeof entrada.itemId !== "string" || !PATRON_ID_PRODUCTO_O_ITEM.test(entrada.itemId)) {
    return { ok: false, mensaje: "Publicación o cuenta inválida." };
  }
  const activar = entrada.activar === true;

  try {
    // La cuenta se resuelve con RLS de la empresa: una cuenta de otra
    // empresa no existe para esta consulta (CuentaMlNoEncontradaError).
    const { status } = await cambiarEstadoItemMl(empresa.id, entrada.cuentaId, entrada.itemId, activar);
    await dbComoEmpresa(empresa.id, (tx) =>
      registrarAuditoria(tx, {
        empresaId: empresa.id,
        usuarioId: usuario.id,
        actorTipo: "persona",
        accion: activar ? "activar_publicacion" : "pausar_publicacion",
        entidad: "publicacion_ml",
        detalle: `${activar ? "Activó" : "Pausó"} la publicación ${entrada.itemId} desde Optimización.`,
      })
    );
    return { ok: true, status: status ?? (activar ? "active" : "paused") };
  } catch (error) {
    return { ok: false, mensaje: error instanceof Error ? error.message : "No se pudo cambiar el estado de la publicación." };
  }
}
