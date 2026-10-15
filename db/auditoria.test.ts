import { randomUUID } from "crypto";
import { eq } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { registrarAuditoria, listarAuditoriaDeEmpresa } from "../lib/auditoria";
import { aceptarInvitacion, crearInvitacion } from "../lib/invitaciones";
import { dbComoEmpresa } from "./empresa-context";
import { db } from "./index";
import { empresas, auditoria, usuarios } from "./schema";

// Tarea 1.9 — prueba real contra Postgres: cada acción deja quién,
// qué, cuándo; un actor "sistema" nunca se mezcla con el nombre de
// una persona; y el aislamiento entre empresas (tarea 1.3/1.4) sigue
// intacto también para esta tabla.

describe("registro de auditoría (tarea 1.9)", () => {
  const empresaAId = randomUUID();
  const empresaBId = randomUUID();
  const usuario1Id = randomUUID();

  beforeAll(async () => {
    await dbComoEmpresa(empresaAId, (tx) =>
      tx.insert(empresas).values({ id: empresaAId, nombre: "Empresa A (prueba 1.9)", nit: `TEST-A19-${empresaAId.slice(0, 8)}` })
    );
    await dbComoEmpresa(empresaBId, (tx) =>
      tx.insert(empresas).values({ id: empresaBId, nombre: "Empresa B (prueba 1.9)", nit: `TEST-B19-${empresaBId.slice(0, 8)}` })
    );
    await db.insert(usuarios).values({ id: usuario1Id, email: `u19-${usuario1Id.slice(0, 8)}@zilonix.test`, nombre: "Ana (prueba 1.9)" });
  });

  it("una acción de persona queda con su nombre real, nunca adivinado", async () => {
    await dbComoEmpresa(empresaAId, (tx) =>
      registrarAuditoria(tx, {
        empresaId: empresaAId,
        usuarioId: usuario1Id,
        actorTipo: "persona",
        accion: "crear",
        entidad: "producto",
        detalle: "Creó el producto de prueba.",
      })
    );

    const filas = await listarAuditoriaDeEmpresa(empresaAId);
    expect(filas).toHaveLength(1);
    expect(filas[0].actorTipo).toBe("persona");
    expect(filas[0].actorNombre).toBe("Ana (prueba 1.9)");
    expect(filas[0].detalle).toBe("Creó el producto de prueba.");
  });

  it("una acción de sistema nunca aparece con el nombre de una persona", async () => {
    await dbComoEmpresa(empresaAId, (tx) =>
      registrarAuditoria(tx, {
        empresaId: empresaAId,
        usuarioId: null,
        actorTipo: "sistema",
        accion: "sincronizar",
        entidad: "venta",
        detalle: "Mercado Libre notificó una venta nueva.",
      })
    );

    const filas = await listarAuditoriaDeEmpresa(empresaAId);
    const deSistema = filas.find((f) => f.accion === "sincronizar");
    expect(deSistema?.actorTipo).toBe("sistema");
    expect(deSistema?.actorNombre).toBe("Sistema / integración");
    expect(deSistema?.actorNombre).not.toContain("Ana");
  });

  it("empresa B no ve nada de la auditoría de empresa A", async () => {
    const filasDesdeB = await listarAuditoriaDeEmpresa(empresaBId);
    expect(filasDesdeB).toHaveLength(0);

    const vistoDirecto = await dbComoEmpresa(empresaBId, (tx) => tx.select().from(auditoria).where(eq(auditoria.empresaId, empresaAId)));
    expect(vistoDirecto).toHaveLength(0);
  });

  it("invitar y aceptar la invitación quedan registrados cada uno, con la persona correcta", async () => {
    const usuario2Id = randomUUID();
    await db.insert(usuarios).values({ id: usuario2Id, email: `u19b-${usuario2Id.slice(0, 8)}@zilonix.test`, nombre: "Beto (prueba 1.9)" });

    const { token } = await crearInvitacion({
      empresaId: empresaAId,
      empresaNombre: "Empresa A (prueba 1.9)",
      email: "beto-1.9@zilonix.test",
      rolNombre: "Operador",
      invitadoPor: usuario1Id,
    });
    await aceptarInvitacion(token, usuario2Id);

    const filas = await listarAuditoriaDeEmpresa(empresaAId);
    const invito = filas.find((f) => f.accion === "invitar");
    const acepto = filas.find((f) => f.accion === "aceptar_invitacion");

    expect(invito?.actorNombre).toBe("Ana (prueba 1.9)");
    expect(acepto?.actorNombre).toBe("Beto (prueba 1.9)");
  });

  it("abrir el mismo link de invitación una segunda vez no duplica el registro de aceptación", async () => {
    const usuario3Id = randomUUID();
    await db.insert(usuarios).values({ id: usuario3Id, email: `u19c-${usuario3Id.slice(0, 8)}@zilonix.test`, nombre: "Carla (prueba 1.9)" });

    const { token } = await crearInvitacion({
      empresaId: empresaAId,
      empresaNombre: "Empresa A (prueba 1.9)",
      email: "carla-1.9@zilonix.test",
      rolNombre: "Operador",
      invitadoPor: usuario1Id,
    });
    await aceptarInvitacion(token, usuario3Id);
    await aceptarInvitacion(token, usuario3Id);

    const filas = await listarAuditoriaDeEmpresa(empresaAId);
    const aceptos = filas.filter((f) => f.accion === "aceptar_invitacion" && f.actorNombre === "Carla (prueba 1.9)");
    expect(aceptos).toHaveLength(1);
  });
});
