import { beforeEach, describe, expect, it, vi } from "vitest";

// Reclamos-Dinero (Refs #646). Sin base ni Mercado Libre: todo simulado.
const estado = vi.hoisted(() => ({ conPermiso: true, cuentaExiste: true, reclamo: null as unknown, ofertas: null as unknown }));
const escribir = vi.hoisted(() => vi.fn());
const auditorias = vi.hoisted(() => [] as { accion: string; detalle?: string }[]);

vi.mock("@/lib/usuarios", () => ({ obtenerOCrearUsuarioActual: async () => ({ id: "usuario-1" }) }));
vi.mock("@/lib/empresas", () => ({ listarEmpresasDeUsuario: async () => [{ id: "empresa-1" }] }));
vi.mock("next/headers", () => ({ cookies: () => ({ get: () => ({ value: "empresa-1" }) }) }));
vi.mock("next/navigation", () => ({ redirect: (u: string) => { throw new Error(`REDIRECT:${u}`); } }));
vi.mock("@/lib/permisos", () => {
  class SinPermisoError extends Error {}
  return { SinPermisoError, requierePermiso: async () => { if (!estado.conPermiso) throw new SinPermisoError("no"); } };
});
vi.mock("@/db/empresa-context", () => ({
  dbComoEmpresa: async (_e: string, fn: (tx: unknown) => Promise<unknown>) =>
    fn({ select: () => ({ from: () => ({ where: async () => (estado.cuentaExiste ? [{ id: CUENTA, nickname: "TIENDA", externa: "7" }] : []) }) }) }),
}));
vi.mock("@/lib/auditoria", () => ({ registrarAuditoria: async (_t: unknown, e: { accion: string; detalle?: string }) => auditorias.push(e) }));
vi.mock("@/lib/ml/cuentas", () => ({ obtenerAccessTokenVigente: async () => "token" }));
vi.mock("@/lib/ml/preguntas", () => ({ motivoCuentaSinRevisar: () => "Token vencido." }));
vi.mock("@/lib/ml/cliente", async () => {
  const real = await vi.importActual<typeof import("@/lib/ml/cliente")>("@/lib/ml/cliente");
  return {
    ...real,
    escribirMl: escribir,
    pedirLecturaMl: async (ruta: string) => {
      if (ruta.endsWith("available-offers")) return { ok: true, data: estado.ofertas };
      return { ok: true, data: estado.reclamo };
    },
  };
});

const CUENTA = "3f2b8c1e-5d4a-4e7b-9a1c-0d2e6f8a4b3c";
import { ejecutarAccionDineroAction } from "./accionesResolucion";

function reclamoMl(acciones: string[], status = "opened") {
  return { id: 5619539113, status, stage: "claim", reason_id: "PDD9939", resource: "order", resource_id: 2000, players: [{ role: "respondent", type: "seller", user_id: 7, available_actions: acciones.map((action) => ({ action })) }] };
}
// Un reclamo distinto por prueba: tras un éxito hay un enfriamiento anti doble envío.
let n = 5619539113;
const entrada = { cuentaId: CUENTA, reclamoId: String(n) };

describe("ejecutarAccionDineroAction", () => {
  beforeEach(() => {
    n += 1;
    entrada.reclamoId = String(n);
    estado.conPermiso = true;
    estado.cuentaExiste = true;
    estado.reclamo = reclamoMl(["allow_partial_refund", "refund", "open_dispute"]);
    estado.ofertas = { currency_id: "COP", available_offers: [{ percentage: 50, amount: 2000 }] };
    escribir.mockReset();
    escribir.mockResolvedValue({ ok: true, status: 200, data: {}, textoCrudo: "" });
    auditorias.length = 0;
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  it("reembolso parcial válido: escribe una vez y audita", async () => {
    const r = await ejecutarAccionDineroAction({ ...entrada, accion: "reembolso_parcial", porcentaje: 50 });
    expect(r.ok).toBe(true);
    expect(escribir).toHaveBeenCalledTimes(1);
    expect(auditorias.map((a) => a.accion)).toEqual(["reclamo.reembolso_parcial_ofrecido"]);
  });

  it("un porcentaje fuera de las ofertas no llama a ML y queda auditado", async () => {
    const r = await ejecutarAccionDineroAction({ ...entrada, accion: "reembolso_parcial", porcentaje: 99 });
    expect(r.ok).toBe(false);
    expect(escribir).not.toHaveBeenCalled();
    expect(auditorias[0].accion).toBe("reclamo.reembolso_parcial_ofrecido_bloqueado");
  });

  it("sin permiso, cuenta ajena, reclamo cerrado o acción no disponible: no llama a ML", async () => {
    estado.conPermiso = false;
    expect((await ejecutarAccionDineroAction({ ...entrada, accion: "reembolso_total" })).ok).toBe(false);
    estado.conPermiso = true;
    estado.cuentaExiste = false;
    expect((await ejecutarAccionDineroAction({ ...entrada, accion: "reembolso_total" })).ok).toBe(false);
    estado.cuentaExiste = true;
    estado.reclamo = reclamoMl(["refund"], "closed");
    expect((await ejecutarAccionDineroAction({ ...entrada, accion: "reembolso_total" })).ok).toBe(false);
    estado.reclamo = reclamoMl(["allow_partial_refund"]);
    expect((await ejecutarAccionDineroAction({ ...entrada, accion: "mediacion" })).ok).toBe(false);
    expect(escribir).not.toHaveBeenCalled();
  });

  it("un rechazo de ML queda en auditoría", async () => {
    escribir.mockResolvedValue({ ok: false, status: 400, data: null, textoCrudo: '{"message":"no se puede"}' });
    const r = await ejecutarAccionDineroAction({ ...entrada, accion: "reembolso_total" });
    expect(r.ok).toBe(false);
    expect(auditorias[0].accion).toBe("reclamo.reembolso_total_rechazado");
  });

  it("doble envío: dos llamadas a la vez escriben una sola vez", async () => {
    const [a, b] = await Promise.all([
      ejecutarAccionDineroAction({ ...entrada, accion: "mediacion" }),
      ejecutarAccionDineroAction({ ...entrada, accion: "mediacion" }),
    ]);
    expect([a.ok, b.ok].filter(Boolean)).toHaveLength(1);
    expect(escribir).toHaveBeenCalledTimes(1);
  });
});
