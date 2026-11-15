import { randomUUID } from "crypto";
import { and, eq } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";
import { db } from "@/db";
import { dbComoEmpresa } from "@/db/empresa-context";
import { auditoria, invitaciones, membresias, permisosRol, roles, usuarios } from "@/db/schema";
import { obtenerMiMembresia } from "@/lib/membresias";
import { SinPermisoError } from "@/lib/permisos";
import { asegurarRolDeEmpresa, PLANTILLAS, permisosDeDueno, type NombrePlantilla } from "@/lib/roles";
import { crearEmpresaConPermisos } from "@/lib/test-utils/empresa-con-permiso";
import { CambioRolInvalidoError, cambiarRolDeMiembro, clavePlantilla, claveRolExistente, listarPersonas, opcionesDeRol } from "./personas";

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
