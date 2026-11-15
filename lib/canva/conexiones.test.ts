import { randomUUID } from "crypto";
import { eq } from "drizzle-orm";
import { afterEach, describe, expect, it, vi } from "vitest";
import { dbComoEmpresa, dbComoEmpresaYUsuario } from "@/db/empresa-context";
import { db } from "@/db/index";
import { canvaConexiones, empresas, usuarios } from "@/db/schema";
import { cifrarToken } from "@/lib/cifrado";
import {
  CandadoDeRenovacionCanvaError,
  ConexionCanvaDesconectadaError,
  ConexionCanvaNoEncontradaError,
  RenovacionTokenCanvaFallidaError,
  desconectarConexion,
  guardarConexion,
  obtenerAccessTokenVigente,
  obtenerEstadoConexion,
} from "./conexiones";

async function crearEmpresa(prefijo: string): Promise<string> {
  const empresaId = randomUUID();
  await dbComoEmpresa(empresaId, (tx) => tx.insert(empresas).values({ id: empresaId, nombre: `Empresa ${prefijo}`, nit: `TEST-CANVA-${prefijo}-${empresaId.slice(0, 8)}` }));
  return empresaId;
}

async function crearUsuario(prefijo: string): Promise<string> {
  const [usuario] = await db
    .insert(usuarios)
    .values({ email: `prueba-canva-${prefijo}-${randomUUID()}@zilonix.test`, nombre: `Usuario ${prefijo}` })
    .returning({ id: usuarios.id });
  return usuario.id;
}

async function crearConexionConCampos(
  empresaId: string,
  usuarioId: string,
  campos: Partial<{ tokenExpiraTs: Date; renovandoTs: Date | null; desconectadaTs: Date | null }> = {}
) {
  const [fila] = await dbComoEmpresaYUsuario(empresaId, usuarioId, (tx) =>
    tx
      .insert(canvaConexiones)
      .values({
        empresaId,
        usuarioId,
        accessTokenCifrado: cifrarToken("access"),
        refreshTokenCifrado: cifrarToken("refresh"),
        tokenExpiraTs: campos.tokenExpiraTs ?? new Date(Date.now() + 3600_000),
        renovandoTs: campos.renovandoTs,
        desconectadaTs: campos.desconectadaTs,
      })
      .returning({ id: canvaConexiones.id })
  );
  return fila.id;
}

describe("guardarConexion — primera conexión y reconexión (ON CONFLICT DO UPDATE)", () => {
  it("primera vez: inserta una fila nueva", async () => {
    const empresaId = await crearEmpresa("GUARDAR-NUEVA");
    const usuarioId = await crearUsuario("guardar-nueva");

    const resultado = await guardarConexion(empresaId, usuarioId, { accessToken: "a1", refreshToken: "r1", expiraEnSegundos: 14_400 });

    const estado = await obtenerEstadoConexion(empresaId, usuarioId);
    expect(estado.conectado).toBe(true);
    expect(resultado.id).toBeDefined();
  });

  it("reconectar: reactiva la MISMA fila (empresa_id+usuario_id es unique), no crea una segunda", async () => {
    const empresaId = await crearEmpresa("RECONECTAR");
    const usuarioId = await crearUsuario("reconectar");

    const primera = await guardarConexion(empresaId, usuarioId, { accessToken: "a1", refreshToken: "r1", expiraEnSegundos: 14_400 });
    await desconectarConexion(empresaId, usuarioId);
    const segunda = await guardarConexion(empresaId, usuarioId, { accessToken: "a2", refreshToken: "r2", expiraEnSegundos: 14_400 });

    expect(segunda.id).toBe(primera.id);
    const estado = await obtenerEstadoConexion(empresaId, usuarioId);
    expect(estado.conectado).toBe(true);
  });
});

describe("obtenerAccessTokenVigente — errores tipados y candado (mismo criterio que lib/ml/cuentas.ts)", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it("sin conexión: ConexionCanvaNoEncontradaError", async () => {
    const empresaId = await crearEmpresa("SIN-CONEXION");
    const usuarioId = await crearUsuario("sin-conexion");
    await expect(obtenerAccessTokenVigente(empresaId, usuarioId)).rejects.toThrow(ConexionCanvaNoEncontradaError);
  });

  it("conexión desconectada (tokens en null): ConexionCanvaDesconectadaError", async () => {
    const empresaId = await crearEmpresa("DESCONECTADA");
    const usuarioId = await crearUsuario("desconectada");
    await guardarConexion(empresaId, usuarioId, { accessToken: "a", refreshToken: "r", expiraEnSegundos: 14_400 });
    await desconectarConexion(empresaId, usuarioId);
    await expect(obtenerAccessTokenVigente(empresaId, usuarioId)).rejects.toThrow(ConexionCanvaDesconectadaError);
  });

  it("token todavía vigente: no renueva nada, no llama a fetch", async () => {
    const empresaId = await crearEmpresa("VIGENTE");
    const usuarioId = await crearUsuario("vigente");
    await crearConexionConCampos(empresaId, usuarioId, { tokenExpiraTs: new Date(Date.now() + 3600_000) });
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    await expect(obtenerAccessTokenVigente(empresaId, usuarioId)).resolves.toBe("access");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("token vencido y Canva rechaza la renovación: RenovacionTokenCanvaFallidaError, nunca el Error crudo de oauth.ts", async () => {
    vi.stubEnv("CANVA_CLIENT_ID", "client-id-de-prueba");
    vi.stubEnv("CANVA_CLIENT_SECRET", "client-secret-de-prueba");
    const empresaId = await crearEmpresa("RENOVACION-FALLA");
    const usuarioId = await crearUsuario("renovacion-falla");
    await crearConexionConCampos(empresaId, usuarioId, { tokenExpiraTs: new Date(Date.now() - 1000) });
    const fetchMock = vi.fn(async () => ({ ok: false, status: 400, text: async () => '{"error":"invalid_grant"}' }) as Response);
    vi.stubGlobal("fetch", fetchMock);
    await expect(obtenerAccessTokenVigente(empresaId, usuarioId)).rejects.toThrow(RenovacionTokenCanvaFallidaError);
    expect(fetchMock).toHaveBeenCalled();
  });

  it("candado: si ya hay una renovación en curso (renovandoTs reciente), se niega sin llamar a Canva", async () => {
    const empresaId = await crearEmpresa("CANDADO");
    const usuarioId = await crearUsuario("candado");
    await crearConexionConCampos(empresaId, usuarioId, { tokenExpiraTs: new Date(Date.now() - 1000), renovandoTs: new Date() });
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    await expect(obtenerAccessTokenVigente(empresaId, usuarioId)).rejects.toThrow(CandadoDeRenovacionCanvaError);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("desconectarConexion — borra los tokens de verdad, nunca borra la fila", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it("marca desconectada_ts y deja los tokens en null", async () => {
    const empresaId = await crearEmpresa("DESCONECTAR-BORRA");
    const usuarioId = await crearUsuario("desconectar-borra");
    await guardarConexion(empresaId, usuarioId, { accessToken: "a", refreshToken: "r", expiraEnSegundos: 14_400 });

    // revocarTokenSiEsPosible intenta un fetch real a Canva — nunca
    // debe bloquear la desconexión aunque falle (ver lib/canva/oauth.ts).
    const fetchMock = vi.fn(async () => {
      throw new Error("red caída, simulado");
    });
    vi.stubGlobal("fetch", fetchMock);

    await desconectarConexion(empresaId, usuarioId);

    const { conectado } = await obtenerEstadoConexion(empresaId, usuarioId);
    expect(conectado).toBe(false);

    const [fila] = await dbComoEmpresaYUsuario(empresaId, usuarioId, (tx) => tx.select().from(canvaConexiones).where(eq(canvaConexiones.empresaId, empresaId)));
    expect(fila.accessTokenCifrado).toBeNull();
    expect(fila.refreshTokenCifrado).toBeNull();
    expect(fila.tokenExpiraTs).toBeNull();
    expect(fila.desconectadaTs).not.toBeNull();
  });
});

describe("un usuario nunca puede usar la conexión de otro — aislamiento a nivel de función, no solo de RLS", () => {
  it("obtenerAccessTokenVigente de la empresa/usuario correctos nunca devuelve el token de otro usuario", async () => {
    const empresaId = await crearEmpresa("NO-CRUZAR");
    const usuarioAId = await crearUsuario("no-cruzar-a");
    const usuarioBId = await crearUsuario("no-cruzar-b");

    await guardarConexion(empresaId, usuarioAId, { accessToken: "access-de-A", refreshToken: "refresh-de-A", expiraEnSegundos: 14_400 });

    await expect(obtenerAccessTokenVigente(empresaId, usuarioBId)).rejects.toThrow(ConexionCanvaNoEncontradaError);

    const tokenDeA = await obtenerAccessTokenVigente(empresaId, usuarioAId);
    expect(tokenDeA).toBe("access-de-A");
  });
});
