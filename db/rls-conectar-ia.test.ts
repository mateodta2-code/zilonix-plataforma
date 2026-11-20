import { randomUUID } from "crypto";
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { dbComoEmpresa } from "./empresa-context";
import { iaConexionModulos, iaConexiones } from "./schema";
import { crearDosEmpresas } from "./test-utils/aislamiento";
import {
  asignarModulos,
  crearConexionIA,
  eliminarConexionIA,
  LimiteConexionesIAError,
  listarConexionesIA,
  marcarPrincipal,
  obtenerConexionIAParaModulo,
  PrincipalNoEliminableError,
} from "../lib/ia/conexion";
import { cifrarToken } from "../lib/cifrado";

// Contra Postgres real (como el resto de db/rls-*.test.ts): corre en CI.
const datos = (nombre: string, proveedor: "anthropic" | "openai" | "xai" = "openai") => ({ nombre, proveedor, baseUrl: null, modelo: "m", apiKey: `key-${nombre}` });

describe("Conectar IA — varias por empresa, principal, módulos y límite de 5", () => {
  it("la primera es principal; marcar otra deja una sola; eliminar la principal con otras -> bloqueado; la única sí", async () => {
    const { empresaAId, usuarioAId } = await crearDosEmpresas();
    const a = await crearConexionIA(empresaAId, usuarioAId, datos("Claude", "anthropic"));
    const b = await crearConexionIA(empresaAId, usuarioAId, datos("ChatGPT"));
    expect(a.esPrincipal).toBe(true);
    expect(b.esPrincipal).toBe(false);
    await expect(eliminarConexionIA(empresaAId, a.id)).rejects.toBeInstanceOf(PrincipalNoEliminableError);
    await marcarPrincipal(empresaAId, b.id);
    expect((await listarConexionesIA(empresaAId)).filter((c) => c.esPrincipal).map((c) => c.id)).toEqual([b.id]);
    await eliminarConexionIA(empresaAId, a.id);
    await expect(eliminarConexionIA(empresaAId, b.id)).resolves.toBeUndefined();
    expect(await listarConexionesIA(empresaAId)).toEqual([]);
  });

  it("ruteo: Grok en investigacion, ChatGPT en promociones, el resto a la principal; mover y borrar; nunca llave de plataforma", async () => {
    const { empresaAId, usuarioAId } = await crearDosEmpresas();
    expect(await obtenerConexionIAParaModulo(empresaAId, "promociones")).toBeNull();
    const claude = await crearConexionIA(empresaAId, usuarioAId, datos("Claude", "anthropic"));
    const chatgpt = await crearConexionIA(empresaAId, usuarioAId, datos("ChatGPT"));
    const grok = await crearConexionIA(empresaAId, usuarioAId, datos("Grok", "xai"));
    await asignarModulos(empresaAId, grok.id, ["investigacion", "generacion_imagenes"]);
    await asignarModulos(empresaAId, chatgpt.id, ["promociones", "publicaciones"]);
    expect((await obtenerConexionIAParaModulo(empresaAId, "investigacion"))?.id).toBe(grok.id);
    expect((await obtenerConexionIAParaModulo(empresaAId, "generacion_imagenes"))?.id).toBe(grok.id);
    expect((await obtenerConexionIAParaModulo(empresaAId, "promociones"))?.apiKey).toBe("key-ChatGPT");
    expect((await obtenerConexionIAParaModulo(empresaAId, "optimizacion"))?.id).toBe(claude.id);
    // Asignarlo a otra lo mueve (un módulo = una sola IA).
    await asignarModulos(empresaAId, chatgpt.id, ["promociones", "investigacion"]);
    expect((await obtenerConexionIAParaModulo(empresaAId, "investigacion"))?.id).toBe(chatgpt.id);
    // Borrar la conexión devuelve sus módulos a la principal.
    await eliminarConexionIA(empresaAId, chatgpt.id);
    expect((await obtenerConexionIAParaModulo(empresaAId, "promociones"))?.id).toBe(claude.id);
  });

  it("límite de 5 por empresa: 6.ª rechazada por la ayuda, por el trigger (insert directo) y bajo concurrencia; otra empresa tiene sus 5; al borrar se puede agregar", async () => {
    const { empresaAId, empresaBId, usuarioAId, usuarioBId } = await crearDosEmpresas();
    const creadas = [];
    for (let i = 0; i < 5; i++) creadas.push(await crearConexionIA(empresaAId, usuarioAId, datos(`IA${i}`)));
    await expect(crearConexionIA(empresaAId, usuarioAId, datos("sexta"))).rejects.toBeInstanceOf(LimiteConexionesIAError);
    await expect(
      dbComoEmpresa(empresaAId, (tx) =>
        tx.insert(iaConexiones).values({ empresaId: empresaAId, nombre: "directa", proveedor: "openai", modelo: "m", apiKeyCifrada: cifrarToken("k") })
      )
    ).rejects.toThrow(/Puedes conectar hasta 5 IA/);
    for (let i = 0; i < 5; i++) await crearConexionIA(empresaBId, usuarioBId, datos(`B${i}`));
    expect(await listarConexionesIA(empresaBId)).toHaveLength(5);
    await eliminarConexionIA(empresaAId, creadas[4].id);
    await expect(crearConexionIA(empresaAId, usuarioAId, datos("nueva"))).resolves.toBeTruthy();

    // Concurrencia: una empresa con 4, ocho altas simultáneas -> en total 5.
    const c = await crearDosEmpresas();
    for (let i = 0; i < 4; i++) await crearConexionIA(c.empresaAId, c.usuarioAId, datos(`C${i}`));
    const resultados = await Promise.allSettled(Array.from({ length: 8 }, (_, i) => crearConexionIA(c.empresaAId, c.usuarioAId, datos(`X${i}`))));
    expect(resultados.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(await listarConexionesIA(c.empresaAId)).toHaveLength(5);
  });

  it("RLS: una empresa no ve, no modifica ni borra conexiones/asignaciones de otra; no se asigna a la conexión ajena", async () => {
    const { empresaAId, empresaBId, usuarioAId } = await crearDosEmpresas();
    const a = await crearConexionIA(empresaAId, usuarioAId, datos("A"));
    await asignarModulos(empresaAId, a.id, ["promociones"]);
    expect(await listarConexionesIA(empresaBId)).toEqual([]);
    expect(await dbComoEmpresa(empresaBId, (tx) => tx.select().from(iaConexionModulos))).toEqual([]);
    expect(await dbComoEmpresa(empresaBId, (tx) => tx.delete(iaConexiones).where(eq(iaConexiones.id, a.id)).returning({ id: iaConexiones.id }))).toEqual([]);
    expect(await dbComoEmpresa(empresaBId, (tx) => tx.delete(iaConexionModulos).returning({ id: iaConexionModulos.id }))).toEqual([]);
    expect(await listarConexionesIA(empresaAId)).toHaveLength(1);
    // FK compuesta: B no puede apuntar a la conexión de A aunque lo intente directo.
    await expect(
      dbComoEmpresa(empresaBId, (tx) => tx.insert(iaConexionModulos).values({ empresaId: empresaBId, conexionId: a.id, modulo: "promociones" }))
    ).rejects.toThrow();
    await expect(
      dbComoEmpresa(empresaAId, (tx) => tx.insert(iaConexionModulos).values({ empresaId: empresaAId, conexionId: randomUUID(), modulo: "promociones" }))
    ).rejects.toThrow();
    // CHECK de módulos.
    await expect(
      dbComoEmpresa(empresaAId, (tx) => tx.insert(iaConexionModulos).values({ empresaId: empresaAId, conexionId: a.id, modulo: "inventado" }))
    ).rejects.toThrow();
  });
});
