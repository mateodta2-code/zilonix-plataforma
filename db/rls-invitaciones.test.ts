import { randomUUID } from "crypto";
import { eq } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { dbComoEmpresa, dbComoInvitacion } from "./empresa-context";
import { db } from "./index";
import { empresas, invitaciones, membresias, usuarios } from "./schema";
import { crearInvitacion, aceptarInvitacion } from "../lib/invitaciones";

async function insertarUsuarioDePrueba(id: string) {
  await db.insert(usuarios).values({ id, email: `prueba-${id.slice(0, 8)}@zilonix.test`, nombre: "Usuario de prueba 1.7" });
}

// Tarea 1.7 — prueba real de la política nueva de `invitaciones`
// (mitad "invitacion_token_actual", ver db/rls-setup.sql): quien tiene
// el token puede leer y aceptar esa fila puntual sin ser miembro de la
// empresa, pero nunca puede verla sin el token, ni ver la de otra
// empresa adivinando uno. Corre contra el mismo Postgres real que las
// pruebas de las tareas 1.4 y 1.6 — RLS no se simula con un mock.

describe("invitaciones por token (RLS, tarea 1.7)", () => {
  const empresaAId = randomUUID();
  const empresaBId = randomUUID();
  const usuarioInvitadoId = randomUUID();
  let tokenA: string;

  beforeAll(async () => {
    await dbComoEmpresa(empresaAId, (tx) =>
      tx.insert(empresas).values({ id: empresaAId, nombre: "Empresa A (prueba 1.7)", nit: `TEST-A17-${empresaAId.slice(0, 8)}` })
    );
    await dbComoEmpresa(empresaBId, (tx) =>
      tx.insert(empresas).values({ id: empresaBId, nombre: "Empresa B (prueba 1.7)", nit: `TEST-B17-${empresaBId.slice(0, 8)}` })
    );
    await insertarUsuarioDePrueba(usuarioInvitadoId);

    const { token } = await crearInvitacion({
      empresaId: empresaAId,
      empresaNombre: "Empresa A (prueba 1.7)",
      email: "invitado-1.7@zilonix.test",
      rolNombre: "Operador",
      invitadoPor: usuarioInvitadoId, // solo necesita ser un usuario válido para la FK
    });
    tokenA = token;
  });

  it("con el token correcto, se puede leer la invitación sin ser miembro de la empresa", async () => {
    const vistas = await dbComoInvitacion(tokenA, null, (tx) => tx.select().from(invitaciones).where(eq(invitaciones.token, tokenA)));
    expect(vistas).toHaveLength(1);
    expect(vistas[0].rolNombre).toBe("Operador");
  });

  it("con un token adivinado (no existe), no se ve ninguna fila", async () => {
    const vistas = await dbComoInvitacion("token-adivinado-no-existe", null, (tx) => tx.select().from(invitaciones));
    expect(vistas).toHaveLength(0);
  });

  it("empresa B no ve la invitación de empresa A ni por su propio contexto normal", async () => {
    const vistas = await dbComoEmpresa(empresaBId, (tx) => tx.select().from(invitaciones).where(eq(invitaciones.token, tokenA)));
    expect(vistas).toHaveLength(0);
  });

  it("aceptar la invitación crea la membresía y la marca aceptada", async () => {
    const { empresaId } = await aceptarInvitacion(tokenA, usuarioInvitadoId);
    expect(empresaId).toBe(empresaAId);

    const membresia = await dbComoEmpresa(empresaAId, (tx) =>
      tx.select().from(membresias).where(eq(membresias.usuarioId, usuarioInvitadoId))
    );
    expect(membresia).toHaveLength(1);

    const invitacion = await dbComoInvitacion(tokenA, null, (tx) => tx.select().from(invitaciones).where(eq(invitaciones.token, tokenA)));
    expect(invitacion[0].aceptadaTs).not.toBeNull();
  });

  it("aceptarla de nuevo (link abierto dos veces) no falla ni duplica la membresía", async () => {
    await expect(aceptarInvitacion(tokenA, usuarioInvitadoId)).resolves.toEqual({ empresaId: empresaAId });
    const membresia = await dbComoEmpresa(empresaAId, (tx) =>
      tx.select().from(membresias).where(eq(membresias.usuarioId, usuarioInvitadoId))
    );
    expect(membresia).toHaveLength(1);
  });

  it("una invitación ya vencida no se puede aceptar", async () => {
    const { token: tokenVencido } = await crearInvitacion({
      empresaId: empresaAId,
      empresaNombre: "Empresa A (prueba 1.7)",
      email: "vencido-1.7@zilonix.test",
      rolNombre: "Contador",
      invitadoPor: usuarioInvitadoId,
    });
    // Se vence a mano, directo en la base (sin pasar por la app), para
    // probar el caso sin esperar 7 días de verdad.
    await dbComoInvitacion(tokenVencido, null, (tx) =>
      tx.update(invitaciones).set({ expiraTs: new Date(Date.now() - 1000) }).where(eq(invitaciones.token, tokenVencido))
    );

    const otroUsuarioId = randomUUID();
    await insertarUsuarioDePrueba(otroUsuarioId);
    await expect(aceptarInvitacion(tokenVencido, otroUsuarioId)).rejects.toThrow();
  });
});
