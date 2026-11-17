import { beforeEach, describe, expect, it, vi } from "vitest";

// Responder una pregunta (Refs #51). Sin base ni Mercado Libre: se
// simulan la sesión, el permiso, la cuenta, el token y POST /answers.

const estado = vi.hoisted(() => ({ conPermiso: true, cuentaExiste: true }));
const responder = vi.hoisted(() => vi.fn());
const auditorias = vi.hoisted(() => [] as unknown[]);

vi.mock("@/lib/usuarios", () => ({ obtenerOCrearUsuarioActual: async () => ({ id: "usuario-1" }) }));
vi.mock("@/lib/empresas", () => ({ listarEmpresasDeUsuario: async () => [{ id: "empresa-1" }] }));
vi.mock("next/headers", () => ({ cookies: () => ({ get: () => ({ value: "empresa-1" }) }) }));
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw new Error(`REDIRECT:${url}`);
  },
}));
vi.mock("@/lib/permisos", () => {
  class SinPermisoError extends Error {}
  return {
    SinPermisoError,
    requierePermiso: async (_u: string, _e: string, modulo: string, accion: string) => {
      if (modulo !== "ventas" || accion !== "modificar") throw new Error("permiso inesperado");
      if (!estado.conPermiso) throw new SinPermisoError("sin permiso");
    },
  };
});
vi.mock("@/db/empresa-context", () => ({
  dbComoEmpresa: async (_empresaId: string, fn: (tx: unknown) => Promise<unknown>) =>
    fn({
      select: () => ({
        from: () => ({
          where: async () => (estado.cuentaExiste ? [{ id: CUENTA, nickname: "TIENDA" }] : []),
        }),
      }),
    }),
}));
vi.mock("@/lib/auditoria", () => ({ registrarAuditoria: async (_tx: unknown, entrada: unknown) => auditorias.push(entrada) }));
vi.mock("@/lib/ml/cuentas", () => ({ obtenerAccessTokenVigente: async () => "token" }));
vi.mock("@/lib/ml/preguntas", () => ({ motivoCuentaSinRevisar: () => "Token vencido — hay que reconectar la cuenta." }));
vi.mock("@/lib/ml/cliente", async () => {
  const real = await vi.importActual<typeof import("@/lib/ml/cliente")>("@/lib/ml/cliente");
  return { ...real, responderPreguntaMl: responder };
});

const CUENTA = "11111111-1111-1111-1111-111111111111";

import { responderPreguntaAction } from "./actions";

describe("responderPreguntaAction", () => {
  beforeEach(() => {
    estado.conPermiso = true;
    estado.cuentaExiste = true;
    responder.mockReset();
    auditorias.length = 0;
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  it("responde con el texto limpio y deja auditoría sin el texto", async () => {
    responder.mockResolvedValue({ ok: true, status: 200, data: {}, textoCrudo: "" });
    const r = await responderPreguntaAction({ cuentaMlId: CUENTA, preguntaId: "123456789", texto: "  Sí, hay stock.  " });
    expect(r).toEqual({ ok: true, aviso: "Respuesta enviada a Mercado Libre." });
    expect(responder).toHaveBeenCalledWith("123456789", "Sí, hay stock.", "token");
    expect(auditorias).toHaveLength(1);
    expect(JSON.stringify(auditorias[0])).not.toContain("Sí, hay stock.");
  });

  it("sin permiso de modificar ventas no llama a Mercado Libre", async () => {
    estado.conPermiso = false;
    const r = await responderPreguntaAction({ cuentaMlId: CUENTA, preguntaId: "1", texto: "hola" });
    expect(r.ok).toBe(false);
    expect(responder).not.toHaveBeenCalled();
  });

  it("rechaza ids mal formados, texto vacío o muy largo", async () => {
    expect((await responderPreguntaAction({ cuentaMlId: "x", preguntaId: "1", texto: "hola" })).ok).toBe(false);
    expect((await responderPreguntaAction({ cuentaMlId: CUENTA, preguntaId: "1;drop", texto: "hola" })).ok).toBe(false);
    expect((await responderPreguntaAction({ cuentaMlId: CUENTA, preguntaId: "1", texto: "   " })).ok).toBe(false);
    expect((await responderPreguntaAction({ cuentaMlId: CUENTA, preguntaId: "1", texto: "a".repeat(2001) })).ok).toBe(false);
    expect(responder).not.toHaveBeenCalled();
  });

  it("una cuenta que no es de la empresa no responde", async () => {
    estado.cuentaExiste = false;
    const r = await responderPreguntaAction({ cuentaMlId: CUENTA, preguntaId: "1", texto: "hola" });
    expect(r.ok).toBe(false);
    expect(responder).not.toHaveBeenCalled();
  });

  it("si Mercado Libre rechaza, muestra su motivo y no audita", async () => {
    responder.mockResolvedValue({ ok: false, status: 400, data: null, textoCrudo: JSON.stringify({ message: "Question already answered" }) });
    const r = await responderPreguntaAction({ cuentaMlId: CUENTA, preguntaId: "1", texto: "hola" });
    expect(r).toEqual({ ok: false, aviso: "Mercado Libre no aceptó la respuesta: Question already answered" });
    expect(auditorias).toHaveLength(0);
  });

  it("un 403 de Mercado Libre pide revisar la conexión, sin el error crudo", async () => {
    responder.mockResolvedValue({ ok: false, status: 403, data: null, textoCrudo: "{\"message\":\"forbidden detalle interno\"}" });
    const r = await responderPreguntaAction({ cuentaMlId: CUENTA, preguntaId: "1", texto: "hola" });
    expect(r.ok).toBe(false);
    expect(r.aviso).not.toContain("detalle interno");
  });
});
