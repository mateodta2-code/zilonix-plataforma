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
import { cuentasMl, promocionesCandidatos } from "@/db/schema";
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
  // Review de Pablo (PR #311) — el ítem tiene que estar registrado en
  // el snapshot de ESTA cuenta para esta empresa (ver el comentario
  // completo junto al chequeo real en route.ts).
  filasPorTabla.set(promocionesCandidatos, [{ empresaId: "empresa-1", cuentaMlId: CUENTA_ID, itemId: "MCO1" }]);
}

describe("POST /api/ml/promociones/participando/salir — rama fix-promociones-aprobadas-participando, punto 3", () => {
  beforeEach(limpiar);
  afterEach(() => vi.clearAllMocks());

  it("tipo que NO se puede dejar por API (DEAL): 400, nunca llega a leer ni a llamar al DELETE", async () => {
    const res = await POST(peticion(cuerpoBase({ tipoPromocion: "DEAL" })));
    expect(res.status).toBe(400);
    expect(leerPromocionesItemMlMock).not.toHaveBeenCalled();
    expect(salirDePromocionMlMock).not.toHaveBeenCalled();
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

  // Review de Pablo (PR #311) — nunca alcanza con que la cuenta sea de
  // la empresa: el ítem puntual tiene que estar registrado bajo ESA
  // cuenta en el snapshot de Promociones (promociones_candidatos) —
  // nunca se confía en la combinación cuentaId+itemId del body a
  // ciegas antes de intentar un DELETE real.
  it("itemId que nunca se vio bajo esa cuenta (no está en el snapshot): 404, nunca llega a leer ni a llamar a Mercado Libre", async () => {
    filasPorTabla.set(promocionesCandidatos, []); // ningún candidato conocido para esta combinación
    const res = await POST(peticion(cuerpoBase()));
    expect(res.status).toBe(404);
    expect(leerPromocionesItemMlMock).not.toHaveBeenCalled();
    expect(salirDePromocionMlMock).not.toHaveBeenCalled();
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
