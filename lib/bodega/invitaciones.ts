import { randomBytes, randomUUID } from "crypto";
import { and, desc, eq } from "drizzle-orm";
import { dbComoBodega, dbComoInvitacionBodega } from "@/db/bodega-context";
import { invitacionesBodega3pl, miembrosBodega3pl } from "@/db/schema";
import { registrarAuditoriaBodega } from "./auditoria";
import { estadoInvitacion, esRolInvitablePorAdmin, type EstadoInvitacionBodega, type RolBodega } from "./roles";

export const DIAS_VALIDEZ_BODEGA = 7;

export function nuevoTokenInvitacion() {
  return { token: randomBytes(24).toString("base64url"), expiraTs: new Date(Date.now() + DIAS_VALIDEZ_BODEGA * 24 * 60 * 60 * 1000) };
}

// El admin_bodega invita operarios y domiciliarios (nunca otro admin: eso
// lo hace el superadmin, lib/superadmin-bodegas.ts). Link de un solo uso
// que vence en 7 días, mostrado en pantalla — igual que lib/invitaciones.ts.
export async function crearInvitacionBodega(params: {
  bodegaId: string;
  bodegaNombre: string;
  email: string;
  rol: string;
  invitadoPor: string;
}): Promise<{ token: string }> {
  const email = params.email.trim();
  if (!email || !email.includes("@")) throw new Error("El correo es obligatorio.");
  const rol = params.rol;
  if (!esRolInvitablePorAdmin(rol)) throw new Error("Elige un rol válido (operario o domiciliario).");
  const { token, expiraTs } = nuevoTokenInvitacion();
  await dbComoBodega(params.bodegaId, async (tx) => {
    const id = randomUUID();
    await tx.insert(invitacionesBodega3pl).values({
      id,
      bodegaId: params.bodegaId,
      email,
      rol,
      bodegaNombre: params.bodegaNombre,
      token,
      invitadoPor: params.invitadoPor,
      expiraTs,
    });
    await registrarAuditoriaBodega(tx, {
      bodegaId: params.bodegaId,
      usuarioId: params.invitadoPor,
      accion: "invitar",
      entidad: "invitacion",
      entidadId: id,
      detalle: `Invitó a una persona como ${rol}.`,
    });
  });
  return { token };
}

export type InvitacionBodegaPublica = {
  bodegaNombre: string;
  rol: RolBodega;
  email: string;
  estado: EstadoInvitacionBodega;
};

// Lectura previa a aceptar, sin sesión: el token en la URL es el permiso.
export async function obtenerInvitacionBodegaPorToken(token: string): Promise<InvitacionBodegaPublica | null> {
  return dbComoInvitacionBodega(token, null, async (tx) => {
    const [inv] = await tx.select().from(invitacionesBodega3pl).where(eq(invitacionesBodega3pl.token, token));
    if (!inv) return null;
    return { bodegaNombre: inv.bodegaNombre, rol: inv.rol, email: inv.email, estado: estadoInvitacion(inv, new Date()) };
  });
}

export class InvitacionBodegaInvalidaError extends Error {
  constructor(mensaje: string) {
    super(mensaje);
    this.name = "InvitacionBodegaInvalidaError";
  }
}

export async function aceptarInvitacionBodega(token: string, usuarioId: string): Promise<{ bodegaId: string; rol: RolBodega }> {
  const { bodegaId, rol, yaEraMiembro } = await dbComoInvitacionBodega(token, usuarioId, async (tx) => {
    const [inv] = await tx.select().from(invitacionesBodega3pl).where(eq(invitacionesBodega3pl.token, token));
    if (!inv) throw new InvitacionBodegaInvalidaError("Invitación no encontrada.");
    const estado = estadoInvitacion(inv, new Date());
    if (estado === "vencida") throw new InvitacionBodegaInvalidaError("Esta invitación ya venció.");
    if (estado === "usada") throw new InvitacionBodegaInvalidaError("Esta invitación ya fue usada.");

    let yaEraMiembro = false;
    try {
      // Savepoint: un choque con la restricción única no puede envenenar
      // la transacción de afuera (mismo motivo que lib/invitaciones.ts).
      await tx.transaction(async (tx2) => {
        await tx2.insert(miembrosBodega3pl).values({ id: randomUUID(), bodegaId: inv.bodegaId, usuarioId, rol: inv.rol });
      });
    } catch (error) {
      if (!(error && typeof error === "object" && "code" in error && error.code === "23505")) throw error;
      yaEraMiembro = true;
    }
    await tx.update(invitacionesBodega3pl).set({ aceptadaTs: new Date() }).where(eq(invitacionesBodega3pl.id, inv.id));
    return { bodegaId: inv.bodegaId, rol: inv.rol, yaEraMiembro };
  });

  // Ya es miembro: el rastro se escribe con la bodega activa de verdad.
  if (!yaEraMiembro) {
    await dbComoBodega(bodegaId, (tx) =>
      registrarAuditoriaBodega(tx, { bodegaId, usuarioId, accion: "aceptar_invitacion", entidad: "miembro", detalle: `Se unió a la bodega como ${rol}.` })
    );
  }
  return { bodegaId, rol };
}

export type InvitacionPendiente = { id: string; email: string; rol: RolBodega; expiraTs: Date; estado: EstadoInvitacionBodega };

export async function listarInvitacionesSinAceptar(bodegaId: string): Promise<InvitacionPendiente[]> {
  const filas = await dbComoBodega(bodegaId, (tx) =>
    tx
      .select()
      .from(invitacionesBodega3pl)
      .where(and(eq(invitacionesBodega3pl.bodegaId, bodegaId)))
      .orderBy(desc(invitacionesBodega3pl.creadoTs))
  );
  const ahora = new Date();
  return filas
    .filter((f) => !f.aceptadaTs)
    .map((f) => ({ id: f.id, email: f.email, rol: f.rol, expiraTs: f.expiraTs, estado: estadoInvitacion(f, ahora) }));
}
