import { beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/db";
import { dbComoEmpresa } from "@/db/empresa-context";
import { asegurarRolDeEmpresa, codificarPermisos, obtenerRolDeEmpresa, PLANTILLAS, reemplazarPermisosDeRol, type Permiso } from "@/lib/roles";
import { crearEmpresaConPermisos } from "@/lib/test-utils/empresa-con-permiso";
import { confirmarPermisosAction, guardarPermisosAction } from "./actions";

// Sharel, 13-nov — el Gerente ya puede ajustar roles
// (configuracion.autorizar). Candado: nadie puede AGREGAR a un rol un
// permiso que no tiene, ni por la pantalla ni llamando la acción
// directo; lo que el rol ya tenía se conserva. Contra Postgres real; solo
// se simulan la sesión, la cookie y la navegación de Next.

vi.setConfig({ testTimeout: 20_000 });

const sesion = vi.hoisted(() => ({ usuarioId: "", empresaId: "" }));

vi.mock("@/lib/usuarios", () => ({ obtenerOCrearUsuarioActual: async () => ({ id: sesion.usuarioId }) }));
vi.mock("next/headers", () => ({ cookies: () => ({ get: () => ({ value: sesion.empresaId }) }) }));
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw new Error(`REDIRECT:${url}`);
  },
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

function formulario(rolId: string, permisos: Permiso[]): FormData {
  const datos = new FormData();
  datos.set("rolId", rolId);
  for (const p of permisos) datos.set(`permiso__${p.modulo}__${p.accion}`, p.alcance);
  return datos;
}

async function correr(accion: () => Promise<unknown>): Promise<string> {
  try {
    await accion();
  } catch (error) {
    const mensaje = (error as Error).message;
    if (mensaje.startsWith("REDIRECT:")) return mensaje;
    return `ERROR:${mensaje}`;
  }
  return "SIN_REDIRECT";
}

// Empresa donde quien entra es un Gerente con la plantilla nueva, más
// un rol Auxiliar para editar.
async function empresaConGerente(nombre: string) {
  const e = await crearEmpresaConPermisos(nombre, PLANTILLAS.Gerente);
  const auxiliarId = await dbComoEmpresa(e.empresaId, (tx) => asegurarRolDeEmpresa(tx as unknown as typeof db, e.empresaId, "Auxiliar"));
  const rolGerente = (await dbComoEmpresa(e.empresaId, async (tx) => {
    const { membresias } = await import("@/db/schema");
    const { eq } = await import("drizzle-orm");
    return (await tx.select().from(membresias).where(eq(membresias.usuarioId, e.usuarioId)))[0].rolId;
  })) as string;
  Object.assign(sesion, { usuarioId: e.usuarioId, empresaId: e.empresaId });
  return { ...e, auxiliarId, rolGerente };
}

const PERSONAS_AUTORIZAR: Permiso = { modulo: "personas", accion: "autorizar", alcance: "todo" };
const PUBLICIDAD_MODIFICAR: Permiso = { modulo: "publicidad", accion: "modificar", alcance: "todo" };

describe("ajustar roles con el candado de no dar lo que no se tiene (Sharel, 13-nov)", () => {
  beforeEach(() => Object.assign(sesion, { usuarioId: "", empresaId: "" }));

  it("el Gerente puede ajustar un rol con permisos que él tiene", async () => {
    const e = await empresaConGerente("Roles gerente ok");
    const nuevos = [...PLANTILLAS.Auxiliar, { modulo: "configuracion" as const, accion: "consultar" as const, alcance: "todo" as const }];
    expect(await correr(() => guardarPermisosAction(formulario(e.auxiliarId, nuevos)))).toBe("REDIRECT:/panel/roles");
    const rol = await obtenerRolDeEmpresa(e.empresaId, e.auxiliarId);
    expect(rol?.permisos).toContainEqual({ modulo: "configuracion", accion: "consultar", alcance: "todo" });
  });

  it("no puede agregar a otro rol un permiso que no tiene; no se guarda nada", async () => {
    const e = await empresaConGerente("Roles gerente otro");
    const r = await correr(() => guardarPermisosAction(formulario(e.auxiliarId, [...PLANTILLAS.Auxiliar, PERSONAS_AUTORIZAR])));
    expect(r).toMatch(/^ERROR:No puedes dar permisos que tu rol no tiene: personas · autorizar/);
    expect((await obtenerRolDeEmpresa(e.empresaId, e.auxiliarId))?.permisos).not.toContainEqual(PERSONAS_AUTORIZAR);
  });

  it("no puede darse más a sí mismo, ni saltándose la pantalla con el paso de confirmar", async () => {
    const e = await empresaConGerente("Roles gerente propio");
    const masPermisos = [...PLANTILLAS.Gerente, PUBLICIDAD_MODIFICAR];
    expect(await correr(() => guardarPermisosAction(formulario(e.rolGerente, masPermisos)))).toMatch(/^ERROR:No puedes dar/);

    const datos = new FormData();
    datos.set("rolId", e.rolGerente);
    datos.set("pendiente", codificarPermisos(masPermisos));
    expect(await correr(() => confirmarPermisosAction(datos))).toMatch(/^ERROR:No puedes dar/);
    expect((await obtenerRolDeEmpresa(e.empresaId, e.rolGerente))?.permisos).not.toContainEqual(PUBLICIDAD_MODIFICAR);
  });

  it("un permiso que el rol ya tenía se conserva al guardar, aunque el Gerente no lo tenga", async () => {
    const e = await empresaConGerente("Roles gerente conserva");
    // El Dueño le había dado publicidad.modificar al Auxiliar.
    const conExtra = [...PLANTILLAS.Auxiliar, PUBLICIDAD_MODIFICAR];
    await reemplazarPermisosDeRol(e.empresaId, e.auxiliarId, conExtra, e.usuarioId);
    expect(await correr(() => guardarPermisosAction(formulario(e.auxiliarId, conExtra)))).toBe("REDIRECT:/panel/roles");
    expect((await obtenerRolDeEmpresa(e.empresaId, e.auxiliarId))?.permisos).toContainEqual(PUBLICIDAD_MODIFICAR);
  });

  it("sin configuracion.autorizar no se ajusta ningún rol", async () => {
    const e = await crearEmpresaConPermisos("Roles sin autorizar", PLANTILLAS.Auxiliar);
    const auxiliarId = await dbComoEmpresa(e.empresaId, (tx) => asegurarRolDeEmpresa(tx as unknown as typeof db, e.empresaId, "Auxiliar"));
    Object.assign(sesion, { usuarioId: e.usuarioId, empresaId: e.empresaId });
    expect(await correr(() => guardarPermisosAction(formulario(auxiliarId, PLANTILLAS.Auxiliar)))).toMatch(/^ERROR:No tienes permiso/);
  });
});
