import { randomUUID } from "crypto";
import { eq } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { registrarAuditoria, listarAuditoriaDeEmpresa, opcionesFiltroAuditoria } from "../lib/auditoria";
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
  // Issue #124 (Z-FIN-02) — la bitácora con filtros sigue mostrando
  // solo eventos de la empresa actual: filtrar desde A por una entidad
  // o una persona que solo existen en B devuelve vacío, y las opciones
  // de los filtros de A nunca listan nada de B.
  it("la bitácora filtrada nunca muestra eventos de otra empresa", async () => {
    const usuarioBId = randomUUID();
    await db.insert(usuarios).values({ id: usuarioBId, email: `u124-${usuarioBId.slice(0, 8)}@zilonix.test`, nombre: "Dora (prueba #124, empresa B)" });
    await dbComoEmpresa(empresaBId, (tx) =>
      registrarAuditoria(tx, {
        empresaId: empresaBId,
        usuarioId: usuarioBId,
        actorTipo: "persona",
        accion: "crear",
        entidad: "gasto_solo_de_b",
        detalle: "Evento que solo existe en la empresa B.",
      })
    );

    expect(await listarAuditoriaDeEmpresa(empresaAId, 50, { entidad: "gasto_solo_de_b" })).toHaveLength(0);
    expect(await listarAuditoriaDeEmpresa(empresaAId, 50, { usuarioId: usuarioBId })).toHaveLength(0);

    const opcionesA = await opcionesFiltroAuditoria(empresaAId);
    expect(opcionesA.entidades).not.toContain("gasto_solo_de_b");
    expect(opcionesA.actores.map((a) => a.valor)).not.toContain(usuarioBId);

    const deB = await listarAuditoriaDeEmpresa(empresaBId, 50, { entidad: "gasto_solo_de_b" });
    expect(deB).toHaveLength(1);
    expect(deB[0].actorNombre).toBe("Dora (prueba #124, empresa B)");
  });

  it("los filtros de la bitácora por entidad y por quién devuelven solo lo pedido", async () => {
    // Datos propios de esta prueba (una fila de sistema y una de
    // "producto" con Ana), para no depender del orden de las de arriba.
    await dbComoEmpresa(empresaAId, async (tx) => {
      await registrarAuditoria(tx, {
        empresaId: empresaAId,
        usuarioId: null,
        actorTipo: "sistema",
        accion: "sincronizar",
        entidad: "venta",
        detalle: "Fila de sistema de la prueba de filtros (#124).",
      });
      await registrarAuditoria(tx, {
        empresaId: empresaAId,
        usuarioId: usuario1Id,
        actorTipo: "persona",
        accion: "modificar",
        entidad: "producto",
        detalle: "Fila de producto de la prueba de filtros (#124).",
      });
    });

    const porPersona = await listarAuditoriaDeEmpresa(empresaAId, 50, { usuarioId: usuario1Id });
    expect(porPersona.length).toBeGreaterThan(0);
    expect(porPersona.every((f) => f.actorNombre === "Ana (prueba 1.9)")).toBe(true);

    const deSistema = await listarAuditoriaDeEmpresa(empresaAId, 50, { usuarioId: "sistema" });
    expect(deSistema.length).toBeGreaterThan(0);
    expect(deSistema.every((f) => f.actorTipo === "sistema")).toBe(true);
    expect(deSistema.map((f) => f.detalle)).toContain("Fila de sistema de la prueba de filtros (#124).");

    const porEntidad = await listarAuditoriaDeEmpresa(empresaAId, 50, { entidad: "producto" });
    expect(porEntidad.length).toBeGreaterThan(0);
    expect(porEntidad.every((f) => f.entidad === "producto")).toBe(true);
    expect(porEntidad.map((f) => f.detalle)).toContain("Fila de producto de la prueba de filtros (#124).");

    const opcionesA = await opcionesFiltroAuditoria(empresaAId);
    expect(opcionesA.entidades).toContain("producto");
    expect(opcionesA.actores.map((a) => a.valor)).toEqual(expect.arrayContaining([usuario1Id, "sistema"]));
  });

  // Issue #125 — app_user solo inserta. UPDATE y DELETE se los quitó
  // el GRANT de db/rls-setup.sql (REVOKE, porque el script es
  // repetible). Los campos nuevos son opcionales: sin ellos, el
  // insert de siempre sigue funcionando.
  it("app_user inserta auditoria con los campos nuevos y no puede actualizarla ni borrarla", async () => {
    await dbComoEmpresa(empresaAId, (tx) =>
      registrarAuditoria(tx, {
        empresaId: empresaAId,
        usuarioId: usuario1Id,
        actorTipo: "persona",
        accion: "modificar",
        entidad: "configuracion_finanzas",
        entidadId: "fila-125",
        valorAnterior: "iva=",
        valorNuevo: "iva=10.00",
        detalle: "Prueba de solo inserción (#125).",
      })
    );

    const [fila] = await dbComoEmpresa(empresaAId, (tx) =>
      tx.select().from(auditoria).where(eq(auditoria.entidadId, "fila-125"))
    );
    expect(fila.valorAnterior).toBe("iva=");
    expect(fila.valorNuevo).toBe("iva=10.00");
    expect(fila.detalle).toBe("Prueba de solo inserción (#125).");

    await expect(
      dbComoEmpresa(empresaAId, (tx) =>
        tx.update(auditoria).set({ detalle: "reescripto" }).where(eq(auditoria.id, fila.id))
      )
    ).rejects.toThrow(/permission denied/i);

    await expect(
      dbComoEmpresa(empresaAId, (tx) => tx.delete(auditoria).where(eq(auditoria.id, fila.id)))
    ).rejects.toThrow(/permission denied/i);

    const [sigue] = await dbComoEmpresa(empresaAId, (tx) =>
      tx.select({ detalle: auditoria.detalle }).from(auditoria).where(eq(auditoria.id, fila.id))
    );
    expect(sigue.detalle).toBe("Prueba de solo inserción (#125).");
  });
});
