import { beforeEach, describe, expect, it, vi } from "vitest";

const listarCuentasConectadas = vi.fn();
const obtenerAccessTokenVigente = vi.fn();
const buscarReclamosAbiertosMl = vi.fn();
const pedirLecturaMl = vi.fn();

vi.mock("@/lib/ml/cuentas", () => ({ listarCuentasConectadas, obtenerAccessTokenVigente }));
vi.mock("@/lib/ml/cliente", () => ({ buscarReclamosAbiertosMl, pedirLecturaMl }));

const { leerConteosPosventa, leerMensajesPendientesMl, sumarConteos } = await import("@/lib/ml/posventaConteos");

describe("leerMensajesPendientesMl", () => {
  it("lee total o suma count; otra forma da null", () => {
    expect(leerMensajesPendientesMl({ total: 4 })).toBe(4);
    expect(leerMensajesPendientesMl({ results: [{ count: 2 }, { count: 3 }] })).toBe(5);
    expect(leerMensajesPendientesMl({ results: [{ count: "x" }] })).toBeNull();
    expect(leerMensajesPendientesMl(null)).toBeNull();
    expect(leerMensajesPendientesMl({})).toBeNull();
  });
});

describe("sumarConteos", () => {
  it("suma, y si una falla el total es null", () => {
    expect(sumarConteos([1, 2])).toBe(3);
    expect(sumarConteos([1, null])).toBeNull();
    expect(sumarConteos([])).toBe(0);
  });
});

describe("leerConteosPosventa", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, "warn").mockImplementation(() => {});
    listarCuentasConectadas.mockResolvedValue([{ id: "c1", desconectadaTs: null }, { id: "c2", desconectadaTs: new Date() }]);
    obtenerAccessTokenVigente.mockResolvedValue("token");
  });

  it("cuenta reclamos y mensajes de las cuentas conectadas", async () => {
    buscarReclamosAbiertosMl.mockResolvedValue({ total: 2, reclamos: [{}, {}] });
    pedirLecturaMl.mockResolvedValue({ ok: true, data: { total: 7 } });
    expect(await leerConteosPosventa("e1")).toEqual({ reclamos: 2, mensajes: 7 });
    expect(obtenerAccessTokenVigente).toHaveBeenCalledTimes(1);
    expect(pedirLecturaMl).toHaveBeenCalledWith("/messages/unread", "token", { query: "?role=seller&tag=post_sale" });
  });

  it("si ML falla devuelve null sin lanzar", async () => {
    buscarReclamosAbiertosMl.mockRejectedValue(new Error("boom"));
    pedirLecturaMl.mockResolvedValue({ ok: false, status: 500, error: { code: null, message: null } });
    expect(await leerConteosPosventa("e1")).toEqual({ reclamos: null, mensajes: null });
  });

  it("si no se pueden listar las cuentas, ambos null", async () => {
    listarCuentasConectadas.mockRejectedValue(new Error("db"));
    expect(await leerConteosPosventa("e1")).toEqual({ reclamos: null, mensajes: null });
  });
});
