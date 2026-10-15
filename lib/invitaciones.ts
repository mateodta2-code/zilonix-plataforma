import { randomBytes, randomUUID } from "crypto";
import { eq } from "drizzle-orm";
import { dbComoEmpresa, dbComoInvitacion } from "@/db/empresa-context";
import { invitaciones, membresias } from "@/db/schema";
import { asegurarRolDeEmpresa, type NombrePlantilla } from "@/lib/roles";

const DIAS_VALIDEZ = 7;

// Tarea 1.7 — "invita por correo con un rol" (diferencial real frente
// a Bling y Effi, docs/investigacion/bling.md y effi.md, sección D: en
// las dos el admin crea cada usuario a mano con contraseña, nunca con
// un link). Todavía no hay proveedor de correo decidido, así que el
// link se genera y se muestra en pantalla para que el dueño lo
// comparta — mandarlo por correo de verdad es un paso de transporte
// que se agrega después, sin tocar este diseño.
export async function crearInvitacion(params: {
  empresaId: string;
  empresaNombre: string;
  email: string;
  rolNombre: NombrePlantilla;
  invitadoPor: string;
}): Promise<{ token: string }> {
  const token = randomBytes(24).toString("base64url");
  const expiraTs = new Date(Date.now() + DIAS_VALIDEZ * 24 * 60 * 60 * 1000);

  await dbComoEmpresa(params.empresaId, async (tx) => {
    const rolId = await asegurarRolDeEmpresa(tx, params.empresaId, params.rolNombre);
    await tx.insert(invitaciones).values({
      id: randomUUID(),
      empresaId: params.empresaId,
      email: params.email,
      rolId,
      empresaNombre: params.empresaNombre,
      rolNombre: params.rolNombre,
      token,
      invitadoPor: params.invitadoPor,
      expiraTs,
    });
  });

  return { token };
}

export type InvitacionPublica = {
  empresaNombre: string;
  rolNombre: string;
  email: string;
  expirada: boolean;
  yaAceptada: boolean;
};

// Lectura previa a aceptar — funciona sin sesión (dbComoInvitacion con
// usuarioId=null): el token en la URL ES el permiso, ver nota en
// db/empresa-context.ts.
export async function obtenerInvitacionPorToken(token: string): Promise<InvitacionPublica | null> {
  return dbComoInvitacion(token, null, async (tx) => {
    const filas = await tx.select().from(invitaciones).where(eq(invitaciones.token, token));
    if (filas.length === 0) return null;
    const inv = filas[0];
    return {
      empresaNombre: inv.empresaNombre,
      rolNombre: inv.rolNombre,
      email: inv.email,
      expirada: inv.expiraTs.getTime() < Date.now(),
      yaAceptada: inv.aceptadaTs !== null,
    };
  });
}

export async function aceptarInvitacion(token: string, usuarioId: string): Promise<{ empresaId: string }> {
  return dbComoInvitacion(token, usuarioId, async (tx) => {
    const filas = await tx.select().from(invitaciones).where(eq(invitaciones.token, token));
    if (filas.length === 0) throw new Error("Invitación no encontrada.");
    const inv = filas[0];
    if (inv.expiraTs.getTime() < Date.now()) throw new Error("Esta invitación ya venció.");

    if (!inv.aceptadaTs) {
      try {
        await tx.insert(membresias).values({ id: randomUUID(), usuarioId, empresaId: inv.empresaId, rolId: inv.rolId });
      } catch (error) {
        // 23505 = unique_violation (membresias_usuario_empresa_unica) —
        // ya era miembro, por ejemplo si volvió a abrir el mismo link.
        // No es un error real, solo no hay nada nuevo que crear.
        if (!(error && typeof error === "object" && "code" in error && error.code === "23505")) throw error;
      }
      await tx.update(invitaciones).set({ aceptadaTs: new Date() }).where(eq(invitaciones.id, inv.id));
    }

    return { empresaId: inv.empresaId };
  });
}
