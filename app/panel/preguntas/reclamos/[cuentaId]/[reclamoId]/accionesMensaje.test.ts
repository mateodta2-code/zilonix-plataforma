import { beforeEach, describe, expect, it, vi } from "vitest";

const resolver = vi.fn();
const enviarMl = vi.fn();
const detalle = vi.fn();
vi.mock("@/lib/posventa/servidor", () => ({
  resolverContextoPosventa: (...a: unknown[]) => resolver(...a),
  archivosDeFormulario: async () => [],
  auditarMensaje: vi.fn(),
  superaLimiteEnvio: () => false,
  superaLimiteIA: () => false,
}));
vi.mock("@/lib/permisos", () => ({ requierePermiso: vi.fn(async () => undefined) }));
vi.mock("@/lib/ml/cuentas", () => ({ obtenerAccessTokenVigente: vi.fn(async () => "tok") }));
vi.mock("@/lib/ml/reclamosMensajes", () => ({ enviarMensajeReclamoMl: (...a: unknown[]) => enviarMl(...a) }));
vi.mock("@/lib/ml/reclamos", async () => ({ ...(await vi.importActual<object>("@/lib/ml/reclamos")), obtenerDetalleReclamoMl: (...a: unknown[]) => detalle(...a) }));
vi.mock("@/lib/ia/respuestasPosventa", () => ({ sugerirRespuestasPosventa: vi.fn() }));

import { enviarMensajeReclamoAction } from "./accionesMensaje";

const ctx = { usuarioId: "u", empresaId: "e", cuenta: { id: "c", cuentaIdExterna: "111", siteId: "MCO", nickname: "tienda" } };
const form = () => {
  const f = new FormData();
  f.set("cuentaId", "c");
  f.set("reclamoId", "5619539113");
  f.set("texto", "hola");
  return f;
};

beforeEach(() => {
  resolver.mockReset();
  enviarMl.mockReset();
  detalle.mockReset();
});

describe("enviarMensajeReclamoAction", () => {
  it("sin permiso o cuenta ajena: no llama a ML", async () => {
    resolver.mockResolvedValue({ ok: false, mensaje: "x" });
    expect((await enviarMensajeReclamoAction(form())).ok).toBe(false);
    expect(detalle).not.toHaveBeenCalled();
    expect(enviarMl).not.toHaveBeenCalled();
  });

  it("acción no disponible en ML: no envía", async () => {
    resolver.mockResolvedValue({ ok: true, ctx });
    detalle.mockResolvedValue({ reclamo: { etapa: "claim" }, accionesVendedor: ["refund"] });
    expect((await enviarMensajeReclamoAction(form())).ok).toBe(false);
    expect(enviarMl).not.toHaveBeenCalled();
  });

  it("acción disponible: envía", async () => {
    resolver.mockResolvedValue({ ok: true, ctx });
    detalle.mockResolvedValue({ reclamo: { etapa: "dispute" }, accionesVendedor: ["send_message_to_mediator"] });
    enviarMl.mockResolvedValue({ ok: true });
    expect((await enviarMensajeReclamoAction(form())).ok).toBe(true);
    expect(enviarMl).toHaveBeenCalledWith(expect.objectContaining({ etapa: "dispute" }));
  });
});
