import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// IMPORTANTE (instrucción explícita de Mateo): "Dejar de participar"
// hace un DELETE real contra Mercado Libre — esta prueba automática
// NUNCA puede llamarlo de verdad. salirDePromocionMl/leerPromocionesItemMl
// quedan MOCKEADOS siempre, sin excepción.
vi.mock("next/headers", () => ({ cookies: vi.fn() }));
vi.mock("@/lib/empresas", () => ({ listarEmpresasDeUsuario: vi.fn(async () => [{ id: "empresa-1", nombre: "Empresa de prueba" }]) }));
vi.mock("@/lib/usuarios", () => ({ obtenerOCrearUsuarioActual: vi.fn(async () => ({ id: "usuario-1" })) }));
vi.mock("@/lib/permisos", () => {
  class SinPermisoError extends Error {
    constructor(modulo: string, accion: string) {
      super(`No tienes permiso para "${accion}" en "${modulo}".`);
      this.name = "SinPermisoError";
    }
  }
  return { requierePermiso: vi.fn(async () => ({})), SinPermisoError };
});
vi.mock("@/lib/url-publica", () => ({ urlPublicaBase: () => "https://staging.test" }));

const { filasPorTabla, insertsPromocionesAcciones } = vi.hoisted(() => ({
  filasPorTabla: new Map<unknown, unknown[]>(),
  insertsPromocionesAcciones: [] as Record<string, unknown>[],
}));

vi.mock("@/db/empresa-context", () => ({
  dbComoEmpresa: async (_empresaId: string, fn: (tx: unknown) => unknown) => {
    const tx = {
      select: () => ({
        from: (tabla: unknown) => ({
          where: async () => filasPorTabla.get(tabla) ?? [],
        }),
      }),
      insert: () => ({
        values: (valores: Record<string, unknown>) => ({
          returning: async () => {
            const fila = { id: `accion-${insertsPromocionesAcciones.length + 1}`, ...valores };
            insertsPromocionesAcciones.push(fila);
            return [fila];
          },
        }),
      }),
    };
    return fn(tx);
  },
}));

const { obtenerAccessTokenVigenteMock } = vi.hoisted(() => ({ obtenerAccessTokenVigenteMock: vi.fn(async () => "token-falso") }));
vi.mock("@/lib/ml/cuentas", () => ({ obtenerAccessTokenVigente: obtenerAccessTokenVigenteMock }));

const { leerPromocionesItemMlMock, salirDePromocionMlMock } = vi.hoisted(() => ({
  leerPromocionesItemMlMock: vi.fn(),
  salirDePromocionMlMock: vi.fn(),
}));
vi.mock("@/lib/ml/cliente", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/ml/cliente")>();
  return { ...real, leerPromocionesItemMl: leerPromocionesItemMlMock, salirDePromocionMl: salirDePromocionMlMock };
});

import { cookies } from "next/headers";
import { cuentasMl } from "@/db/schema";
import { LimiteMercadoLibreError } from "@/lib/ml/cliente";
import { requierePermiso } from "@/lib/permisos";
import { obtenerOCrearUsuarioActual } from "@/lib/usuarios";
import { POST } from "./route";

const CUENTA_ID = "11111111-1111-1111-1111-111111111111";

function mockearCookies() {
  vi.mocked(cookies).mockReturnValue({ get: () => undefined } as unknown as ReturnType<typeof cookies>);
}

function peticion(cuerpo: Record<string, unknown>): Request {
  return new Request("https://staging.test/api/ml/promociones/participando/salir", {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: "https://staging.test" },
    body: JSON.stringify(cuerpo),
  });
}

function cuerpoBase(overrides: Record<string, unknown> = {}) {
  return { cuentaId: CUENTA_ID, itemId: "MCO1", promotionIdMl: "PROMO-1", tipoPromocion: "PRICE_DISCOUNT", ...overrides };
}

function limpiar() {
  vi.clearAllMocks();
  filasPorTabla.clear();
  insertsPromocionesAcciones.length = 0;
  mockearCookies();
  vi.mocked(obtenerOCrearUsuarioActual).mockResolvedValue({ id: "usuario-1" } as never);
  vi.mocked(requierePermiso).mockResolvedValue({} as never);
  obtenerAccessTokenVigenteMock.mockResolvedValue("token-falso");
  filasPorTabla.set(cuentasMl, [{ id: CUENTA_ID, empresaId: "empresa-1", nickname: "Cuenta de prueba" }]);
}

describe("POST /api/ml/promociones/participando/salir — rama fix-promociones-aprobadas-participando, punto 3", () => {
  beforeEach(limpiar);
  afterEach(() => vi.clearAllMocks());

  it("tipo que NO se puede dejar por API (DOD, la Oferta del día real): 400, nunca llega a leer ni a llamar al DELETE", async () => {
    const res = await POST(peticion(cuerpoBase({ tipoPromocion: "DOD" })));
    expect(res.status).toBe(400);
    expect(leerPromocionesItemMlMock).not.toHaveBeenCalled();
    expect(salirDePromocionMlMock).not.toHaveBeenCalled();
  });

  // Tarea "Promociones-Ajustes-1" — bug real confirmado en staging:
  // DEAL es la "Campaña tradicional" (no la Oferta del día real, que
  // es DOD) y SÍ se puede dejar por API — antes se bloqueaba por una
  // confusión de nombres entre los dos tipos.
  it("DEAL (Campaña tradicional, no la Oferta del día real): SÍ se puede dejar por API", async () => {
    leerPromocionesItemMlMock.mockResolvedValue({ estado: "ok", promociones: [{ id: "PROMO-1", type: "DEAL", status: "started", price: 90000 }] });
    salirDePromocionMlMock.mockResolvedValue({ ok: true, status: 200, textoCrudo: "{}" });

    const res = await POST(peticion(cuerpoBase({ tipoPromocion: "DEAL" })));
    expect(res.status).toBe(200);
    expect(salirDePromocionMlMock).toHaveBeenCalledWith("MCO1", "token-falso", "PROMO-1", "DEAL");
  });

  it("caso feliz: revalida fresco, llama a salirDePromocionMl (MOCKEADO) y guarda quién y cuándo", async () => {
    leerPromocionesItemMlMock.mockResolvedValue({ estado: "ok", promociones: [{ id: "PROMO-1", type: "PRICE_DISCOUNT", status: "started", price: 90000 }] });
    salirDePromocionMlMock.mockResolvedValue({ ok: true, status: 200, textoCrudo: "{}" });

    const res = await POST(peticion(cuerpoBase()));
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(salirDePromocionMlMock).toHaveBeenCalledWith("MCO1", "token-falso", "PROMO-1", "PRICE_DISCOUNT");
    expect(insertsPromocionesAcciones).toHaveLength(1);
    expect(insertsPromocionesAcciones[0]).toMatchObject({
      accion: "salir",
      estado: "ejecutada",
      ejecutadoPor: "usuario-1",
      precioAntes: "90000",
    });
    expect(insertsPromocionesAcciones[0].ejecutadoTs).toBeInstanceOf(Date);
  });

  it("Mercado Libre rechaza el DELETE: queda 'fallida' con el motivo real, nunca se trata como éxito", async () => {
    leerPromocionesItemMlMock.mockResolvedValue({ estado: "ok", promociones: [{ id: "PROMO-1", type: "PRICE_DISCOUNT", status: "started", price: 90000 }] });
    salirDePromocionMlMock.mockResolvedValue({ ok: false, status: 422, textoCrudo: '{"message":"no se puede"}' });

    const res = await POST(peticion(cuerpoBase()));
    expect(res.status).toBe(502);
    expect(insertsPromocionesAcciones[0]).toMatchObject({ estado: "fallida" });
    expect((insertsPromocionesAcciones[0].error as string)).toContain("422");
  });

  it("ya no está started/pending al revalidar (ya salió por otro lado): ok, nunca llama al DELETE, pero SÍ queda en la auditoría", async () => {
    leerPromocionesItemMlMock.mockResolvedValue({ estado: "ok", promociones: [] });

    const res = await POST(peticion(cuerpoBase()));
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.yaNoParticipaba).toBe(true);
    expect(salirDePromocionMlMock).not.toHaveBeenCalled();
    // Review de Pablo (PR #311) — antes se perdía: ni rastro de que
    // alguien clickeó "Dejar de participar" sobre algo que ya no
    // estaba activo.
    expect(insertsPromocionesAcciones).toHaveLength(1);
    expect(insertsPromocionesAcciones[0]).toMatchObject({ accion: "salir", estado: "ejecutada", ejecutadoPor: "usuario-1" });
    expect(insertsPromocionesAcciones[0].resultadoMl).toMatchObject({ yaNoParticipaba: true, llamoAMercadoLibre: false });
  });

  // Tarea "Promociones-Ajustes-1" — bug real confirmado en staging: el
  // flujo nuevo (lista en vivo) nunca escribe promociones_candidatos,
  // así que exigir una fila ahí hacía que "Dejar de participar"
  // SIEMPRE devolviera 404 "volvé a Buscar" — se sacó ese chequeo (ver
  // comentario en route.ts). Un itemId que esta cuenta nunca vio en
  // Mercado Libre sigue sin poder salir: simplemente no aparece como
  // started/pending al revalidar fresco (caso "ya no participaba",
  // probado arriba) — nunca llega a 404, llega a 200 con
  // yaNoParticipaba:true.
  it("itemId sin ninguna fila previa en promociones_candidatos: YA NO devuelve 404 — sigue con la revalidación fresca normal", async () => {
    leerPromocionesItemMlMock.mockResolvedValue({ estado: "ok", promociones: [{ id: "PROMO-1", type: "PRICE_DISCOUNT", status: "started", price: 90000 }] });
    salirDePromocionMlMock.mockResolvedValue({ ok: true, status: 200, textoCrudo: "{}" });

    const res = await POST(peticion(cuerpoBase({ itemId: "MCO-NUNCA-VISTO" })));
    expect(res.status).toBe(200);
    expect(leerPromocionesItemMlMock).toHaveBeenCalledWith("MCO-NUNCA-VISTO", "token-falso");
  });

  // Tarea "Promociones real" (Refs #295) — 423 (Locked, visto real
  // contra Mercado Libre) reintenta una vez antes de rendirse, con un
  // mensaje claro de qué pasó.
  it("423 (Locked): reintenta una vez; si el reintento sale bien, queda 'ejecutada'", async () => {
    leerPromocionesItemMlMock.mockResolvedValue({ estado: "ok", promociones: [{ id: "PROMO-1", type: "PRICE_DISCOUNT", status: "started", price: 90000 }] });
    salirDePromocionMlMock.mockResolvedValueOnce({ ok: false, status: 423, textoCrudo: "" }).mockResolvedValueOnce({ ok: true, status: 200, textoCrudo: "{}" });

    const res = await POST(peticion(cuerpoBase()));
    expect(res.status).toBe(200);
    expect(salirDePromocionMlMock).toHaveBeenCalledTimes(2);
    expect(insertsPromocionesAcciones[0]).toMatchObject({ estado: "ejecutada" });
  });

  it("423 (Locked) persistente tras el reintento: 423, con mensaje claro de qué pasó", async () => {
    leerPromocionesItemMlMock.mockResolvedValue({ estado: "ok", promociones: [{ id: "PROMO-1", type: "PRICE_DISCOUNT", status: "started", price: 90000 }] });
    salirDePromocionMlMock.mockResolvedValue({ ok: false, status: 423, textoCrudo: "" });

    const res = await POST(peticion(cuerpoBase()));
    const body = await res.json();
    expect(res.status).toBe(423);
    expect(salirDePromocionMlMock).toHaveBeenCalledTimes(2);
    expect(body.error).toMatch(/bloqueó este producto/i);
    expect(insertsPromocionesAcciones[0]).toMatchObject({ estado: "fallida" });
  });

  // 429 (límite de peticiones real de Mercado Libre) — reintenta una
  // vez; si sigue limitado, nunca se adivina si el DELETE pasó o no
  // (no queda en la auditoría como "fallida", sería inventar un
  // resultado sin confirmar).
  it("429 persistente tras el reintento: 429, nunca queda en la auditoría como 'fallida' sin confirmar", async () => {
    leerPromocionesItemMlMock.mockResolvedValue({ estado: "ok", promociones: [{ id: "PROMO-1", type: "PRICE_DISCOUNT", status: "started", price: 90000 }] });
    salirDePromocionMlMock.mockRejectedValue(new LimiteMercadoLibreError(2000));

    const res = await POST(peticion(cuerpoBase()));
    const body = await res.json();
    expect(res.status).toBe(429);
    expect(salirDePromocionMlMock).toHaveBeenCalledTimes(2);
    expect(body.error).toMatch(/limitando las peticiones/i);
    expect(insertsPromocionesAcciones).toHaveLength(0);
  });

  it("429 en el primer intento, bien en el reintento: queda 'ejecutada'", async () => {
    leerPromocionesItemMlMock.mockResolvedValue({ estado: "ok", promociones: [{ id: "PROMO-1", type: "PRICE_DISCOUNT", status: "started", price: 90000 }] });
    salirDePromocionMlMock.mockRejectedValueOnce(new LimiteMercadoLibreError(100)).mockResolvedValueOnce({ ok: true, status: 200, textoCrudo: "{}" });

    const res = await POST(peticion(cuerpoBase()));
    expect(res.status).toBe(200);
    expect(insertsPromocionesAcciones[0]).toMatchObject({ estado: "ejecutada" });
  });

  it("cuentaId con formato inválido: 400", async () => {
    const res = await POST(peticion(cuerpoBase({ cuentaId: "no-es-un-uuid" })));
    expect(res.status).toBe(400);
  });

  it("origen inválido: 403, nunca llega a tocar nada", async () => {
    const res = await POST(
      new Request("https://staging.test/api/ml/promociones/participando/salir", {
        method: "POST",
        headers: { "Content-Type": "application/json", Origin: "https://otro-sitio.test" },
        body: JSON.stringify(cuerpoBase()),
      })
    );
    expect(res.status).toBe(403);
    expect(leerPromocionesItemMlMock).not.toHaveBeenCalled();
  });
});
