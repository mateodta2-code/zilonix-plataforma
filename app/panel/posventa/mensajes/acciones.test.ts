import { beforeEach, describe, expect, it, vi } from "vitest";

const resolver = vi.fn();
const enviarMl = vi.fn();
const auditar = vi.fn();
vi.mock("@/lib/posventa/servidor", async () => ({
  ...(await vi.importActual<object>("@/lib/posventa/adjuntos")),
  resolverContextoPosventa: (...a: unknown[]) => resolver(...a),
  archivosDeFormulario: async () => [],
  auditarMensaje: (...a: unknown[]) => auditar(...a),
  superaLimiteEnvio: () => false,
  superaLimiteIA: () => false,
}));
vi.mock("@/lib/permisos", () => ({ requierePermiso: vi.fn(async () => undefined) }));
vi.mock("@/lib/ml/cuentas", () => ({ obtenerAccessTokenVigente: vi.fn(async () => "tok") }));
vi.mock("@/lib/ml/mensajesPosventaEnvio", () => ({ enviarMensajeVentaMl: (...a: unknown[]) => enviarMl(...a) }));
vi.mock("@/lib/ml/mensajesPosventa", async () => ({ ...(await vi.importActual<object>("@/lib/ml/mensajesPosventa")), leerCompradorIdMl: vi.fn(async () => "222"), leerConversacionMl: vi.fn(async () => []) }));
vi.mock("@/lib/ia/respuestasPosventa", () => ({ sugerirRespuestasPosventa: vi.fn() }));

import { enviarMensajeVentaAction } from "./acciones";

const ctx = { usuarioId: "u", empresaId: "e", cuenta: { id: "c", cuentaIdExterna: "111", siteId: "MCO", nickname: "tienda" } };
const form = (texto: string, packId = "200") => {
  const f = new FormData();
  f.set("cuentaId", "c");
  f.set("packId", packId);
  f.set("texto", texto);
  return f;
};

beforeEach(() => {
  resolver.mockReset();
  enviarMl.mockReset();
  auditar.mockReset();
});

describe("enviarMensajeVentaAction", () => {
  it("sin permiso o cuenta ajena: no llama a ML", async () => {
    resolver.mockResolvedValue({ ok: false, mensaje: "No tienes permiso para responder en Posventa." });
    const r = await enviarMensajeVentaAction(form("hola"));
    expect(r.ok).toBe(false);
    expect(enviarMl).not.toHaveBeenCalled();
    expect(auditar).not.toHaveBeenCalled();
  });

  it("envío correcto: llama a ML y audita sin el texto", async () => {
    resolver.mockResolvedValue({ ok: true, ctx });
    enviarMl.mockResolvedValue({ ok: true });
    const r = await enviarMensajeVentaAction(form("texto privado"));
    expect(r).toEqual({ ok: true, mensaje: "Mensaje enviado." });
    expect(enviarMl).toHaveBeenCalledWith(expect.objectContaining({ packOOrden: "200", vendedorId: "111", compradorId: "222" }));
    expect(auditar).toHaveBeenCalledWith(ctx, "posventa.mensaje_enviado", "200", 0);
    expect(JSON.stringify(auditar.mock.calls)).not.toContain("texto privado");
  });

  it("texto vacío o pack inválido: no llama a ML", async () => {
    resolver.mockResolvedValue({ ok: true, ctx });
    expect((await enviarMensajeVentaAction(form("   "))).ok).toBe(false);
    expect((await enviarMensajeVentaAction(form("hola", "../x"))).ok).toBe(false);
    expect(enviarMl).not.toHaveBeenCalled();
  });
});
