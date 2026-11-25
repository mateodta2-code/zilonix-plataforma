import { randomUUID } from "crypto";
import { and, eq } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";
import { db } from "@/db";
import { dbComoEmpresa } from "@/db/empresa-context";
import { auditoria, invitaciones, membresias, permisosRol, roles, usuarios } from "@/db/schema";
import { obtenerMiMembresia } from "@/lib/membresias";
import { SinPermisoError, SoloDuenoError } from "@/lib/permisos";
import { asegurarRolDeEmpresa, PLANTILLAS, permisosDeDueno, type NombrePlantilla } from "@/lib/roles";
import { crearEmpresaConPermisos } from "@/lib/test-utils/empresa-con-permiso";
import { CambioRolInvalidoError, cambiarRolDeMiembro, clavePlantilla, claveRolExistente, listarPersonas, opcionesDeRol, QuitarAccesoInvalidoError, quitarAccesoDeMiembro } from "./personas";

// Issue #370 — Personas, contra Postgres real (RLS y permisos reales).

vi.setConfig({ testTimeout: 20_000 });

const AHORA = new Date("2026-11-13T15:00:00Z");

// Una persona más en la empresa, con un rol de plantilla (o «Dueño»).
async function agregarMiembro(empresaId: string, rol: NombrePlantilla | "Dueño", nombre = `Persona ${rol}`) {
  const usuarioId = randomUUID();
  await db.insert(usuarios).values({ id: usuarioId, email: `persona-${usuarioId.slice(0, 8)}@zilonix.test`, nombre });
  return dbComoEmpresa(empresaId, async (tx) => {
    let rolId: string;
    if (rol === "Dueño") {
      rolId = randomUUID();
      await tx.insert(roles).values({ id: rolId, nombre: "Dueño", empresaId });
      await tx.insert(permisosRol).values(permisosDeDueno().map((p) => ({ rolId, ...p })));
    } else {
      rolId = await asegurarRolDeEmpresa(tx as unknown as typeof db, empresaId, rol);
    }
    const [m] = await tx.insert(membresias).values({ usuarioId, empresaId, rolId }).returning({ id: membresias.id });
    return { usuarioId, membresiaId: m.id, rolId };
  });
}

async function invitar(empresaId: string, invitadoPor: string, email: string, expiraTs: Date, aceptada = false) {
  await dbComoEmpresa(empresaId, async (tx) => {
    const rolId = await asegurarRolDeEmpresa(tx as unknown as typeof db, empresaId, "Operador");
    await tx.insert(invitaciones).values({
      empresaId,
      email,
      rolId,
      empresaNombre: "Prueba",
      rolNombre: "Operador",
      token: randomUUID(),
      invitadoPor,
      expiraTs,
      aceptadaTs: aceptada ? AHORA : null,
    });
  });
}

describe("Personas (issue #370)", () => {
  it("lista miembros con su rol e invitaciones sin aceptar (pendientes y vencidas); B no ve a A", async () => {
    const a = await crearEmpresaConPermisos("Personas A", PLANTILLAS.Gerente);
    const operador = await agregarMiembro(a.empresaId, "Operador", "Ana Operadora");
    await invitar(a.empresaId, a.usuarioId, "nuevo@zilonix.test", new Date("2026-11-20T00:00:00Z"));
    await invitar(a.empresaId, a.usuarioId, "viejo@zilonix.test", new Date("2026-11-01T00:00:00Z"));
    await invitar(a.empresaId, a.usuarioId, "ya-entro@zilonix.test", new Date("2026-11-20T00:00:00Z"), true);

    const p = await listarPersonas(a.empresaId, a.usuarioId, AHORA);
    expect(p.miembros.map((m) => [m.usuarioId, m.rolNombre])).toEqual([
      [a.usuarioId, "Rol de prueba"],
      [operador.usuarioId, "Operador"],
    ]);
    expect(p.miembros[1]).toMatchObject({ nombre: "Ana Operadora" });
    expect(p.invitaciones.map((i) => [i.email, i.estado])).toEqual([
      ["nuevo@zilonix.test", "pendiente"],
      ["viejo@zilonix.test", "vencida"],
    ]);

    const b = await crearEmpresaConPermisos("Personas B", PLANTILLAS.Gerente);
    const deB = await listarPersonas(b.empresaId, b.usuarioId, AHORA);
    expect(deB.miembros.map((m) => m.usuarioId)).toEqual([b.usuarioId]);
    expect(deB.invitaciones).toEqual([]);
  });

  it("Operador → Gerente sin reinvitar: cambia la membresía, su menú lo ve y queda en la bitácora", async () => {
    const e = await crearEmpresaConPermisos("Personas cambio", PLANTILLAS.Gerente);
    const operador = await agregarMiembro(e.empresaId, "Operador");
    const r = await cambiarRolDeMiembro(e.empresaId, e.usuarioId, operador.membresiaId, clavePlantilla("Gerente"));
    expect(r).toEqual({ antes: "Operador", despues: "Gerente" });

    const suya = await obtenerMiMembresia(operador.usuarioId, e.empresaId);
    expect(suya?.rolNombre).toBe("Gerente");
    expect(suya?.permisos).toContainEqual({ modulo: "finanzas", accion: "consultar", alcance: "todo" });

    const [fila] = await dbComoEmpresa(e.empresaId, (tx) =>
      tx.select().from(auditoria).where(and(eq(auditoria.empresaId, e.empresaId), eq(auditoria.accion, "cambiar_rol")))
    );
    expect(fila).toMatchObject({ usuarioId: e.usuarioId, entidad: "membresia", entidadId: operador.membresiaId, valorAnterior: "Operador", valorNuevo: "Gerente" });

    // El rol Gerente ya existe ahora: se ofrece por su id, una sola vez.
    const opciones = await opcionesDeRol(e.empresaId, PLANTILLAS.Gerente);
    expect(opciones.filter((o) => o.nombre === "Gerente").map((o) => o.clave)).toEqual([claveRolExistente((await obtenerMiMembresia(operador.usuarioId, e.empresaId))!.rolId)]);
  });

  it("no asigna un rol con permisos que quien edita no tiene, y nunca ofrece «Dueño»", async () => {
    // Tecnología: personas.modificar sí, finanzas no.
    const e = await crearEmpresaConPermisos("Personas escalada", PLANTILLAS.Tecnología);
    const operador = await agregarMiembro(e.empresaId, "Operador");
    await agregarMiembro(e.empresaId, "Dueño");

    const opciones = await opcionesDeRol(e.empresaId, PLANTILLAS.Tecnología);
    expect(opciones.find((o) => o.nombre === "Gerente")?.puedeDar).toBe(false);
    expect(opciones.find((o) => o.nombre === "Operaciones")?.puedeDar).toBe(false);
    expect(opciones.some((o) => o.nombre === "Dueño")).toBe(false);

    await expect(cambiarRolDeMiembro(e.empresaId, e.usuarioId, operador.membresiaId, clavePlantilla("Gerente"))).rejects.toThrow(/no puede asignar el rol Gerente/);
    const dueno = (await listarPersonas(e.empresaId, e.usuarioId, AHORA)).miembros.find((m) => m.rolNombre === "Dueño")!;
    await expect(cambiarRolDeMiembro(e.empresaId, e.usuarioId, operador.membresiaId, claveRolExistente(dueno.rolId))).rejects.toBeInstanceOf(CambioRolInvalidoError);
    expect((await obtenerMiMembresia(operador.usuarioId, e.empresaId))?.rolNombre).toBe("Operador");
  });

  it("no cambia al Dueño ni el propio rol; sin personas.modificar no cambia nada", async () => {
    const e = await crearEmpresaConPermisos("Personas protegidos", PLANTILLAS.Gerente);
    const dueno = await agregarMiembro(e.empresaId, "Dueño");
    const yo = (await listarPersonas(e.empresaId, e.usuarioId, AHORA)).miembros.find((m) => m.usuarioId === e.usuarioId)!;
    await expect(cambiarRolDeMiembro(e.empresaId, e.usuarioId, dueno.membresiaId, clavePlantilla("Operador"))).rejects.toThrow(/Dueño/);
    await expect(cambiarRolDeMiembro(e.empresaId, e.usuarioId, yo.membresiaId, clavePlantilla("Operador"))).rejects.toThrow(/propio rol/);

    const soloVe = await crearEmpresaConPermisos("Personas solo ver", [{ modulo: "personas", accion: "consultar" }]);
    const otro = await agregarMiembro(soloVe.empresaId, "Operador");
    expect((await listarPersonas(soloVe.empresaId, soloVe.usuarioId, AHORA)).miembros).toHaveLength(2);
    await expect(cambiarRolDeMiembro(soloVe.empresaId, soloVe.usuarioId, otro.membresiaId, clavePlantilla("Operador"))).rejects.toBeInstanceOf(SinPermisoError);

    const sinPersonas = await crearEmpresaConPermisos("Personas sin permiso", [{ modulo: "ventas", accion: "consultar" }]);
    await expect(listarPersonas(sinPersonas.empresaId, sinPersonas.usuarioId, AHORA)).rejects.toBeInstanceOf(SinPermisoError);
  });

  it("A/B: no cambia la membresía de otra empresa aunque tenga el id", async () => {
    const a = await crearEmpresaConPermisos("Personas AB — A", PLANTILLAS.Gerente);
    const b = await crearEmpresaConPermisos("Personas AB — B", PLANTILLAS.Gerente);
    const deA = await agregarMiembro(a.empresaId, "Operador");
    await expect(cambiarRolDeMiembro(b.empresaId, b.usuarioId, deA.membresiaId, clavePlantilla("Auxiliar"))).rejects.toThrow(/no está en esta empresa/);
    expect((await obtenerMiMembresia(deA.usuarioId, a.empresaId))?.rolNombre).toBe("Operador");
  });
});

// 25-nov — «Quitar acceso», solo el Dueño.
describe("Personas: quitar acceso", () => {
  const correoDe = async (usuarioId: string) => (await db.select({ email: usuarios.email }).from(usuarios).where(eq(usuarios.id, usuarioId)))[0].email;

  it("el Dueño le quita el acceso a un Operador: sale de la empresa, se borran sus invitaciones sin aceptar y queda en la bitácora", async () => {
    const e = await crearEmpresaConPermisos("Quitar acceso", PLANTILLAS.Gerente);
    const dueno = await agregarMiembro(e.empresaId, "Dueño", "Dueña");
    const op = await agregarMiembro(e.empresaId, "Operador", "Ana Operadora");
    const correo = await correoDe(op.usuarioId);
    await invitar(e.empresaId, dueno.usuarioId, correo, new Date(Date.now() + 86_400_000));
    await invitar(e.empresaId, dueno.usuarioId, "otra@zilonix.test", new Date(Date.now() + 86_400_000));

    expect(await quitarAccesoDeMiembro(e.empresaId, dueno.usuarioId, op.membresiaId)).toEqual({ email: correo, rolNombre: "Operador" });

    expect(await obtenerMiMembresia(op.usuarioId, e.empresaId)).toBeNull();
    const pendientes = await dbComoEmpresa(e.empresaId, (tx) => tx.select({ email: invitaciones.email }).from(invitaciones).where(eq(invitaciones.empresaId, e.empresaId)));
    expect(pendientes.map((i) => i.email)).toEqual(["otra@zilonix.test"]); // solo se borran las de esa persona
    const [registro] = await dbComoEmpresa(e.empresaId, (tx) =>
      tx.select().from(auditoria).where(and(eq(auditoria.empresaId, e.empresaId), eq(auditoria.accion, "quitar_acceso")))
    );
    expect(registro).toMatchObject({ usuarioId: dueno.usuarioId, entidadId: op.membresiaId, valorAnterior: "Operador" });
  });

  it("solo el Dueño; nunca al Dueño ni a uno mismo", async () => {
    const e = await crearEmpresaConPermisos("Quitar acceso reglas", PLANTILLAS.Gerente);
    const dueno = await agregarMiembro(e.empresaId, "Dueño");
    const otroDueno = await agregarMiembro(e.empresaId, "Dueño");
    const op = await agregarMiembro(e.empresaId, "Operador");

    // Un Gerente (con personas.modificar) no puede: es solo del Dueño.
    await expect(quitarAccesoDeMiembro(e.empresaId, e.usuarioId, op.membresiaId)).rejects.toBeInstanceOf(SoloDuenoError);
    await expect(quitarAccesoDeMiembro(e.empresaId, dueno.usuarioId, otroDueno.membresiaId)).rejects.toThrow(/Dueño no se le puede quitar/);
    await expect(quitarAccesoDeMiembro(e.empresaId, dueno.usuarioId, dueno.membresiaId)).rejects.toBeInstanceOf(QuitarAccesoInvalidoError);
    expect((await obtenerMiMembresia(op.usuarioId, e.empresaId))?.rolNombre).toBe("Operador");
    expect((await obtenerMiMembresia(otroDueno.usuarioId, e.empresaId))?.rolNombre).toBe("Dueño");
  });

  it("A/B: el Dueño de B no puede quitar a alguien de A aunque tenga el id", async () => {
    const a = await crearEmpresaConPermisos("Quitar A", PLANTILLAS.Gerente);
    const b = await crearEmpresaConPermisos("Quitar B", PLANTILLAS.Gerente);
    const duenoB = await agregarMiembro(b.empresaId, "Dueño");
    const deA = await agregarMiembro(a.empresaId, "Operador");
    await expect(quitarAccesoDeMiembro(b.empresaId, duenoB.usuarioId, deA.membresiaId)).rejects.toThrow(/no está en esta empresa/);
    expect((await obtenerMiMembresia(deA.usuarioId, a.empresaId))?.rolNombre).toBe("Operador");
  });
});

