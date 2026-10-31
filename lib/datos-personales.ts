import { and, desc, eq } from "drizzle-orm";
import { clerkClient } from "@clerk/nextjs/server";
import { db } from "@/db";
import { dbComoEmpresa } from "@/db/empresa-context";
import { auditoria, membresias, roles, usuarios } from "@/db/schema";
import { registrarAuditoria } from "@/lib/auditoria";
import { listarEmpresasDeUsuario } from "@/lib/empresas";

// Issue #318 (Ley 1581 de 2012) — autoservicio: cada usuario exporta o
// borra SOLO su propia cuenta (sacar a un miembro del equipo es otro
// flujo, de un admin, y no se toca acá). `usuario` SIEMPRE sale de la
// sesión real (obtenerOCrearUsuarioActual, nunca de un id que mande el
// cliente) — ninguna función de este archivo recibe el id de otra
// persona, así que no hace falta más candado que "haber iniciado
// sesión". Por eso ninguna ruta de app/panel/mis-datos/ llama
// requierePermiso(): no es un permiso de módulo que un rol pueda dar o
// quitar, es un derecho sobre los datos propios (ver RUTAS_EXENTAS en
// scripts/verificar-permisos.test.ts).

export type UsuarioPropio = {
  id: string;
  nombre: string;
  email: string;
  clerkUserId: string | null;
  creadoTs: Date;
};

type MiembroEmpresa = { usuarioId: string; rolNombre: string };

async function listarMiembrosDeEmpresa(empresaId: string): Promise<MiembroEmpresa[]> {
  return dbComoEmpresa(empresaId, (tx) =>
    tx
      .select({ usuarioId: membresias.usuarioId, rolNombre: roles.nombre })
      .from(membresias)
      .innerJoin(roles, eq(membresias.rolId, roles.id))
      .where(eq(membresias.empresaId, empresaId))
  );
}

// "Dueño" nace con TODO sobre TODO y nunca se puede editar/borrar desde
// el panel (lib/empresas.ts, lib/roles.ts) — por eso es el único rol
// cuya ausencia deja una empresa sin nadie que pueda administrarla.
// Bloquea el borrado SOLO cuando además hay otros miembros de por
// medio (una empresa donde esta persona es la única fila, sin nadie
// más, no deja a nadie "huérfano" si se va).
const ROL_DUENO = "Dueño";

async function empresasBloqueadasPorDuenoUnico(usuarioId: string, empresaIds: string[]): Promise<Map<string, string>> {
  const bloqueadas = new Map<string, string>(); // empresaId -> motivo (para el mensaje)
  for (const empresaId of empresaIds) {
    const miembros = await listarMiembrosDeEmpresa(empresaId);
    const duenos = miembros.filter((m) => m.rolNombre === ROL_DUENO);
    const esDuenoUnico = duenos.length === 1 && duenos[0].usuarioId === usuarioId;
    if (esDuenoUnico && miembros.length > 1) bloqueadas.set(empresaId, "unico_dueno_con_mas_miembros");
  }
  return bloqueadas;
}

export type ResultadoAnonimizacion =
  | { ok: true; clerkBorrado: boolean }
  | { ok: false; motivo: "unico_dueno_con_mas_miembros"; empresas: string[] };

// Nunca borra la fila de `usuarios` (varias tablas de "quién hizo qué"
// la referencian con onDelete "restrict" — accesos_temporales,
// invitaciones, pedido_items, seguimientos_ml — un DELETE real
// fallaría o perdería ese historial). Anonimiza en el lugar: mismo id,
// mismo título "Usuario eliminado" que ya usa auditoria.ts cuando el
// join no encuentra a nadie — nunca se inventa un texto nuevo.
export async function anonimizarCuentaPropia(usuario: UsuarioPropio): Promise<ResultadoAnonimizacion> {
  const empresasDeUsuario = await listarEmpresasDeUsuario(usuario.id);
  const bloqueadas = await empresasBloqueadasPorDuenoUnico(
    usuario.id,
    empresasDeUsuario.map((e) => e.id)
  );
  if (bloqueadas.size > 0) {
    return {
      ok: false,
      motivo: "unico_dueno_con_mas_miembros",
      empresas: empresasDeUsuario.filter((e) => bloqueadas.has(e.id)).map((e) => e.nombre),
    };
  }

  // email único por usuario.id (nunca choca con un borrado anterior);
  // nombre, el mismo texto que ya usa el resto de la app para "esta
  // persona ya no está".
  const emailAnonimo = `usuario-eliminado-${usuario.id}@eliminado.zilonix.app`;
  await db.update(usuarios).set({ email: emailAnonimo, nombre: "Usuario eliminado" }).where(eq(usuarios.id, usuario.id));

  for (const empresa of empresasDeUsuario) {
    await dbComoEmpresa(empresa.id, async (tx) => {
      await tx.delete(membresias).where(and(eq(membresias.usuarioId, usuario.id), eq(membresias.empresaId, empresa.id)));
      await registrarAuditoria(tx, {
        empresaId: empresa.id,
        usuarioId: usuario.id,
        actorTipo: "persona",
        accion: "anonimizar",
        entidad: "usuario",
        entidadId: usuario.id,
        detalle: "La persona pidió borrar su propia cuenta (Ley 1581) — datos anonimizados, membresía en esta empresa eliminada.",
      });
    });
  }

  // Clerk, SIEMPRE después de lo de arriba, y solo si de verdad había
  // una cuenta vinculada. Si falla, lo de arriba ya quedó hecho —
  // nunca se revierte la anonimización por esto — y el error se
  // registra en auditoria, nunca se traga en silencio ni se loguea el
  // mensaje completo sin acotar.
  if (!usuario.clerkUserId) return { ok: true, clerkBorrado: true };

  try {
    const cliente = await clerkClient();
    await cliente.users.deleteUser(usuario.clerkUserId);
    await db.update(usuarios).set({ clerkUserId: null }).where(eq(usuarios.id, usuario.id));
    return { ok: true, clerkBorrado: true };
  } catch (error) {
    const mensaje = (error instanceof Error ? error.message : String(error)).slice(0, 300);
    for (const empresa of empresasDeUsuario) {
      await dbComoEmpresa(empresa.id, (tx) =>
        registrarAuditoria(tx, {
          empresaId: empresa.id,
          usuarioId: null,
          actorTipo: "sistema",
          accion: "error",
          entidad: "usuario",
          entidadId: usuario.id,
          detalle: `No se pudo borrar el usuario en Clerk después de anonimizar sus datos: ${mensaje}`,
        })
      );
    }
    return { ok: true, clerkBorrado: false };
  }
}

export type ExportacionDatosPersonales = {
  generadoTs: string;
  perfil: { id: string; nombre: string; email: string; creadoTs: string };
  membresias: { empresa: string; rol: string; desde: string }[];
  auditoria: { empresa: string; ts: string; accion: string; entidad: string; detalle: string | null }[];
};

// JSON, nunca CSV/Excel — issue #318 solo pide "exportación", y un JSON
// con texto libre (detalle de auditoria) no corre riesgo de que una
// coma rompa columnas. Nunca incluye tokens de Mercado Libre,
// ML_TOKEN_KEY ni ninguna clave: esta función no toca cuentas_ml ni
// nada cifrado, solo usuarios/membresias/roles/auditoria.
export async function exportarDatosPropios(usuario: UsuarioPropio): Promise<ExportacionDatosPersonales> {
  const empresasDeUsuario = await listarEmpresasDeUsuario(usuario.id);
  const membresiasExport: ExportacionDatosPersonales["membresias"] = [];
  const auditoriaExport: ExportacionDatosPersonales["auditoria"] = [];

  for (const empresa of empresasDeUsuario) {
    await dbComoEmpresa(empresa.id, async (tx) => {
      const [miMembresia] = await tx
        .select({ rolNombre: roles.nombre, desde: membresias.creadoTs })
        .from(membresias)
        .innerJoin(roles, eq(membresias.rolId, roles.id))
        .where(and(eq(membresias.usuarioId, usuario.id), eq(membresias.empresaId, empresa.id)));
      if (miMembresia) membresiasExport.push({ empresa: empresa.nombre, rol: miMembresia.rolNombre, desde: miMembresia.desde.toISOString() });

      const filasAuditoria = await tx
        .select({ ts: auditoria.ts, accion: auditoria.accion, entidad: auditoria.entidad, detalle: auditoria.detalle })
        .from(auditoria)
        .where(and(eq(auditoria.empresaId, empresa.id), eq(auditoria.usuarioId, usuario.id)))
        .orderBy(desc(auditoria.ts));
      for (const f of filasAuditoria) {
        auditoriaExport.push({ empresa: empresa.nombre, ts: f.ts.toISOString(), accion: f.accion, entidad: f.entidad, detalle: f.detalle });
      }

      await registrarAuditoria(tx, {
        empresaId: empresa.id,
        usuarioId: usuario.id,
        actorTipo: "persona",
        accion: "exportar",
        entidad: "usuario",
        entidadId: usuario.id,
        detalle: "La persona exportó sus propios datos personales (Ley 1581).",
      });
    });
  }

  return {
    generadoTs: new Date().toISOString(),
    perfil: { id: usuario.id, nombre: usuario.nombre, email: usuario.email, creadoTs: usuario.creadoTs.toISOString() },
    membresias: membresiasExport,
    auditoria: auditoriaExport,
  };
}
