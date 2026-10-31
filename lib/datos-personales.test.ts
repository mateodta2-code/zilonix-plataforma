import { randomUUID } from "crypto";
import { and, eq } from "drizzle-orm";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

// Issue #318 — igual que lib/usuarios.test.ts: necesita Postgres real
// (DATABASE_URL_APP) para probar RLS de verdad, nunca simulado. Se
// deja a CI cuando falta la variable, en vez de copiar .env/conectar
// Railway acá.
const HAY_POSTGRES = Boolean(process.env.DATABASE_URL_APP);

vi.mock("server-only", () => ({}));
vi.mock("@clerk/nextjs/server", async (importOriginal) => {
  const real = await importOriginal<typeof import("@clerk/nextjs/server")>();
  return { ...real, clerkClient: vi.fn() };
});

describe.skipIf(!HAY_POSTGRES)("lib/datos-personales.ts (issue #318, Ley 1581)", () => {
  let db: (typeof import("@/db"))["db"];
  let usuarios: (typeof import("@/db/schema"))["usuarios"];
  let membresias: (typeof import("@/db/schema"))["membresias"];
  let roles: (typeof import("@/db/schema"))["roles"];
  let auditoria: (typeof import("@/db/schema"))["auditoria"];
  let crearEmpresaConDueno: (typeof import("@/lib/empresas"))["crearEmpresaConDueno"];
  let exportarDatosPropios: (typeof import("./datos-personales"))["exportarDatosPropios"];
  let anonimizarCuentaPropia: (typeof import("./datos-personales"))["anonimizarCuentaPropia"];
  let clerkClient: (typeof import("@clerk/nextjs/server"))["clerkClient"];

  beforeAll(async () => {
    ({ db } = await import("@/db"));
    ({ usuarios, membresias, roles, auditoria } = await import("@/db/schema"));
    ({ crearEmpresaConDueno } = await import("@/lib/empresas"));
    ({ exportarDatosPropios, anonimizarCuentaPropia } = await import("./datos-personales"));
    ({ clerkClient } = await import("@clerk/nextjs/server"));
  });

  afterEach(() => vi.restoreAllMocks());

  async function crearUsuarioDePrueba(clerkUserId: string | null = null) {
    const [usuario] = await db
      .insert(usuarios)
      .values({ email: `prueba-datos-personales-${randomUUID()}@zilonix.test`, nombre: "Persona de prueba", clerkUserId })
      .returning();
    return usuario;
  }

  it("exportarDatosPropios: perfil, membresía (empresa y rol) y su propia auditoría — nunca otras claves", async () => {
    const usuario = await crearUsuarioDePrueba();
    const empresaId = await crearEmpresaConDueno(usuario.id, "Empresa de prueba export", `TEST-EXPORT-${randomUUID().slice(0, 8)}`);

    const exportacion = await exportarDatosPropios(usuario);

    expect(Object.keys(exportacion).sort()).toEqual(["auditoria", "generadoTs", "membresias", "perfil"]);
    expect(exportacion.perfil).toEqual({ id: usuario.id, nombre: usuario.nombre, email: usuario.email, creadoTs: usuario.creadoTs.toISOString() });
    expect(exportacion.membresias).toEqual([{ empresa: "Empresa de prueba export", rol: "Dueño", desde: expect.any(String) }]);
    // crearEmpresaConDueno ya registró una fila de auditoria ("crear
    // empresa") — exportarDatosPropios trae esa Y la suya propia
    // ("exportar") se registra DESPUÉS de leer, así que todavía no
    // aparece en este mismo resultado.
    expect(exportacion.auditoria).toHaveLength(1);
    expect(exportacion.auditoria[0]).toMatchObject({ empresa: "Empresa de prueba export", accion: "crear", entidad: "empresa" });

    // La propia llamada SÍ quedó registrada para la próxima exportación.
    const segunda = await exportarDatosPropios(usuario);
    expect(segunda.auditoria.map((a) => a.accion).sort()).toEqual(["crear", "exportar"]);
  });

  it("anonimizarCuentaPropia: anonimiza el usuario, borra la membresía, registra auditoria y borra en Clerk", async () => {
    const clerkUserId = `clerk-borrar-${randomUUID()}`;
    const usuario = await crearUsuarioDePrueba(clerkUserId);
    const empresaId = await crearEmpresaConDueno(usuario.id, "Empresa de prueba borrar", `TEST-BORRAR-${randomUUID().slice(0, 8)}`);

    const deleteUser = vi.fn().mockResolvedValue({});
    vi.mocked(clerkClient).mockResolvedValue({ users: { deleteUser } } as never);

    const resultado = await anonimizarCuentaPropia(usuario);

    expect(resultado).toEqual({ ok: true, clerkBorrado: true });
    expect(deleteUser).toHaveBeenCalledWith(clerkUserId);

    const [filaUsuario] = await db.select().from(usuarios).where(eq(usuarios.id, usuario.id));
    expect(filaUsuario.nombre).toBe("Usuario eliminado");
    expect(filaUsuario.email).not.toBe(usuario.email);
    expect(filaUsuario.clerkUserId).toBeNull();

    const quedaMembresia = await db.select().from(membresias).where(and(eq(membresias.usuarioId, usuario.id), eq(membresias.empresaId, empresaId)));
    expect(quedaMembresia).toHaveLength(0);

    const filasAuditoria = await db.select().from(auditoria).where(and(eq(auditoria.empresaId, empresaId), eq(auditoria.entidadId, usuario.id)));
    expect(filasAuditoria.map((f) => f.accion)).toContain("anonimizar");
  });

  it("bloquea el borrado si es el único Dueño de una empresa con más miembros", async () => {
    const usuario = await crearUsuarioDePrueba();
    const empresaId = await crearEmpresaConDueno(usuario.id, "Empresa con equipo", `TEST-EQUIPO-${randomUUID().slice(0, 8)}`);

    const otraPersona = await crearUsuarioDePrueba();
    const [rolOtro] = await db.insert(roles).values({ nombre: "Operador", empresaId }).returning({ id: roles.id });
    await db.insert(membresias).values({ usuarioId: otraPersona.id, empresaId, rolId: rolOtro.id });

    const resultado = await anonimizarCuentaPropia(usuario);

    expect(resultado).toEqual({ ok: false, motivo: "unico_dueno_con_mas_miembros", empresas: ["Empresa con equipo"] });

    // Nada se tocó: ni el usuario ni la membresía.
    const [filaUsuario] = await db.select().from(usuarios).where(eq(usuarios.id, usuario.id));
    expect(filaUsuario.nombre).toBe(usuario.nombre);
    const sigueLaMembresia = await db.select().from(membresias).where(and(eq(membresias.usuarioId, usuario.id), eq(membresias.empresaId, empresaId)));
    expect(sigueLaMembresia).toHaveLength(1);
  });

  it("si Clerk falla, la anonimización en la base queda hecha y el error se registra en auditoria", async () => {
    const clerkUserId = `clerk-falla-${randomUUID()}`;
    const usuario = await crearUsuarioDePrueba(clerkUserId);
    const empresaId = await crearEmpresaConDueno(usuario.id, "Empresa de prueba falla clerk", `TEST-FALLA-${randomUUID().slice(0, 8)}`);

    vi.mocked(clerkClient).mockResolvedValue({
      users: { deleteUser: vi.fn().mockRejectedValue(new Error("Clerk no respondió")) },
    } as never);

    const resultado = await anonimizarCuentaPropia(usuario);

    expect(resultado).toEqual({ ok: true, clerkBorrado: false });

    const [filaUsuario] = await db.select().from(usuarios).where(eq(usuarios.id, usuario.id));
    expect(filaUsuario.nombre).toBe("Usuario eliminado");
    // clerkUserId NUNCA se limpia si Clerk no confirmó el borrado —
    // así queda la pista para reintentarlo después.
    expect(filaUsuario.clerkUserId).toBe(clerkUserId);

    const filasError = await db.select().from(auditoria).where(and(eq(auditoria.empresaId, empresaId), eq(auditoria.accion, "error")));
    expect(filasError).toHaveLength(1);
    expect(filasError[0].actorTipo).toBe("sistema");
    expect(filasError[0].detalle).toContain("Clerk no respondió");
  });

  it("sin cuenta de Clerk vinculada (clerkUserId null): anonimiza igual, nunca llama a Clerk", async () => {
    const usuario = await crearUsuarioDePrueba(null);
    await crearEmpresaConDueno(usuario.id, "Empresa sin clerk", `TEST-SINCLERK-${randomUUID().slice(0, 8)}`);

    const resultado = await anonimizarCuentaPropia(usuario);

    expect(resultado).toEqual({ ok: true, clerkBorrado: true });
    expect(clerkClient).not.toHaveBeenCalled();
  });
});
