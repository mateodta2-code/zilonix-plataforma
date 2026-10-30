import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Mismo patrón que app/api/ml/promociones/buscar/route.test.ts.
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

const { filasPorTabla } = vi.hoisted(() => ({ filasPorTabla: new Map<unknown, unknown[]>() }));

// Mismo criterio que lib/trabajos/buscarPromocionesMultiCuenta.test.ts
// — una "tx" mínima que devuelve lo programado POR TABLA, ignorando la
// condición real del .where()/.innerJoin()/.orderBy() (este repo ya
// usa ese mismo atajo en varios tests).
vi.mock("@/db/empresa-context", () => ({
  dbComoEmpresa: async (_empresaId: string, fn: (tx: unknown) => unknown) => {
    const tx = {
      select: () => ({
        from: (tabla: unknown) => {
          const filas = filasPorTabla.get(tabla) ?? [];
          type Encadenable = {
            innerJoin: () => Encadenable;
            where: () => Encadenable;
            orderBy: () => Encadenable;
            limit: (n: number) => Promise<unknown[]>;
            then: Promise<unknown[]>["then"];
          };
          const encadenable: Encadenable = {
            innerJoin: () => encadenable,
            where: () => encadenable,
            orderBy: () => encadenable,
            limit: (n: number) => Promise.resolve(filas.slice(0, n)),
            then: (...args) => Promise.resolve(filas).then(...args),
          };
          return encadenable;
        },
      }),
    };
    return fn(tx);
  },
}));

import { cookies } from "next/headers";
import { cuentasMl, promocionesAcciones, promocionesCandidatos } from "@/db/schema";
import { requierePermiso } from "@/lib/permisos";
import { obtenerOCrearUsuarioActual } from "@/lib/usuarios";
import { GET } from "./route";

function candidatoFila(overrides: Record<string, unknown> = {}) {
  return {
    id: "candidato-1",
    cuentaMlId: "cuenta-1",
    nicknameCuenta: "Cuenta 1",
    itemId: "MCO1",
    skuCodigo: "SKU-1",
    tituloProducto: "Producto",
    thumbnail: null,
    tieneVariantes: false,
    tipoPromocion: "DEAL",
    estadoMl: "candidate",
    esCompartida: false,
    soloEnMl: false,
    precioOriginal: "100000",
    precioActual: "100000",
    precioMinimo: "90000",
    precioSugerido: "90000",
    maxDiscountedPrice: null,
    gananciaEstimada: "40000",
    cumpleReglas: true,
    motivoRevisarManual: null,
    actualizadoTs: new Date(),
    ...overrides,
  };
}

function accionFila(overrides: Record<string, unknown> = {}) {
  return {
    cuentaMlId: "cuenta-1",
    itemId: "MCO1",
    tipoPromocion: "DEAL",
    estado: "rechazada",
    error: null,
    creadoTs: new Date(),
    ...overrides,
  };
}

function mockearCookies() {
  vi.mocked(cookies).mockReturnValue({ get: () => undefined } as unknown as ReturnType<typeof cookies>);
}

function peticion(filtro?: string): Request {
  const url = filtro ? `https://staging.test/api/ml/promociones/candidatos?filtro=${filtro}` : "https://staging.test/api/ml/promociones/candidatos";
  return new Request(url);
}

// Rama feat-promociones-editar-precio, punto 2 — "Sí/No sacan la fila
// de la lista". El estado de decisión se deriva de la ÚLTIMA fila de
// promociones_acciones, nunca se guarda en promociones_candidatos.
describe("GET /api/ml/promociones/candidatos — estado de decisión derivado (rama feat-promociones-editar-precio)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockearCookies();
    vi.mocked(obtenerOCrearUsuarioActual).mockResolvedValue({ id: "usuario-1" } as never);
    vi.mocked(requierePermiso).mockResolvedValue({} as never);
    filasPorTabla.clear();
    filasPorTabla.set(cuentasMl, []);
  });

  afterEach(() => vi.unstubAllGlobals());

  it("sin ninguna acción: todas las filas salen como pendientes en el filtro por default", async () => {
    filasPorTabla.set(promocionesCandidatos, [candidatoFila()]);
    filasPorTabla.set(promocionesAcciones, []);
    const res = await GET(peticion());
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.filas).toHaveLength(1);
    expect(body.filas[0].estadoDecision).toBeNull();
    expect(body.conteos.todas).toBe(1);
  });

  it("candidato con una acción 'aceptada' más reciente: sale de 'todas', aparece en 'aprobadas'", async () => {
    filasPorTabla.set(promocionesCandidatos, [candidatoFila()]);
    filasPorTabla.set(promocionesAcciones, [accionFila({ estado: "aceptada", creadoTs: new Date() })]);

    const resTodas = await GET(peticion("todas"));
    expect((await resTodas.json()).filas).toHaveLength(0);

    const resAprobadas = await GET(peticion("aprobadas"));
    const bodyAprobadas = await resAprobadas.json();
    expect(bodyAprobadas.filas).toHaveLength(1);
    expect(bodyAprobadas.filas[0].estadoDecision).toBe("aceptada");
  });

  // Punto 2 — "Buscar de nuevo NO resucita como pendiente algo ya
  // rechazado de la misma promo e ítem": una búsqueda nueva solo
  // vuelve a upsertear promociones_candidatos (acá simulado con una
  // fila "fresca", como si viniera de un re-search), nunca toca
  // promociones_acciones — la fila "rechazada" vieja sigue siendo la
  // ÚLTIMA, así que el candidato sigue fuera de "todas"/"pendientes".
  it("una búsqueda nueva (candidato re-upserteado) NUNCA resucita un rechazo viejo como pendiente", async () => {
    filasPorTabla.set(promocionesCandidatos, [candidatoFila({ actualizadoTs: new Date() })]); // "fresco", como si se hubiera vuelto a buscar
    filasPorTabla.set(promocionesAcciones, [accionFila({ estado: "rechazada", error: "No cumple el tope de descuento.", creadoTs: new Date(Date.now() - 60_000) })]);

    const resTodas = await GET(peticion("todas"));
    expect((await resTodas.json()).filas).toHaveLength(0);

    const resRechazadas = await GET(peticion("rechazadas"));
    const bodyRechazadas = await resRechazadas.json();
    expect(bodyRechazadas.filas).toHaveLength(1);
    expect(bodyRechazadas.filas[0].estadoDecision).toBe("rechazada");
    // Punto 4 — el motivo real del rechazo (silencioso o no) viaja hasta la fila.
    expect(bodyRechazadas.filas[0].motivoRechazo).toBe("No cumple el tope de descuento.");
  });

  // "Volver a pendiente" — una fila "pendiente" más reciente que la
  // "rechazada" vuelve a traer el candidato a la vista principal.
  it("'volver a pendiente' (una fila 'pendiente' más reciente que el rechazo) devuelve el candidato a 'todas'", async () => {
    filasPorTabla.set(promocionesCandidatos, [candidatoFila()]);
    filasPorTabla.set(promocionesAcciones, [
      accionFila({ estado: "pendiente", creadoTs: new Date() }), // más reciente
      accionFila({ estado: "rechazada", creadoTs: new Date(Date.now() - 60_000) }), // más vieja
    ]);
    const res = await GET(peticion("todas"));
    const body = await res.json();
    expect(body.filas).toHaveLength(1);
    expect(body.filas[0].estadoDecision).toBe("pendiente");
  });

  it("motivoRechazo solo viaja cuando estadoDecision es 'rechazada' — nunca para 'aceptada'/'pendiente'", async () => {
    filasPorTabla.set(promocionesCandidatos, [candidatoFila()]);
    filasPorTabla.set(promocionesAcciones, [accionFila({ estado: "aceptada", error: "esto no debería aparecer" })]);
    const res = await GET(peticion("aprobadas"));
    const body = await res.json();
    expect(body.filas[0].motivoRechazo).toBeNull();
  });

  it("conteos: cumplen/revisar/sin-minimo/solo-ml solo cuentan PENDIENTES, nunca ya decididos", async () => {
    filasPorTabla.set(promocionesCandidatos, [
      candidatoFila({ id: "c1", cumpleReglas: true, soloEnMl: false, precioMinimo: "90000" }), // pendiente, cumple
      candidatoFila({ id: "c2", itemId: "MCO2", cumpleReglas: true }), // va a quedar aprobada
      candidatoFila({ id: "c3", itemId: "MCO3", cumpleReglas: false, soloEnMl: false, precioMinimo: "90000" }), // pendiente, revisar
      // sin precioMinimo: la misma falta de piso implica que el motor nunca pudo confirmar cumpleReglas,
      // así que también cae en "revisar" (los conteos no son una partición excluyente, son contadores por filtro).
      candidatoFila({ id: "c4", itemId: "MCO4", cumpleReglas: false, soloEnMl: false, precioMinimo: null }), // pendiente, sin mínimo
      candidatoFila({ id: "c5", itemId: "MCO5", cumpleReglas: false, soloEnMl: true, precioMinimo: "90000" }), // pendiente, solo ml
    ]);
    filasPorTabla.set(promocionesAcciones, [accionFila({ itemId: "MCO2", estado: "aceptada" })]);

    const res = await GET(peticion());
    const body = await res.json();
    expect(body.conteos.todas).toBe(4); // c1, c3, c4, c5 — c2 ya está aprobada
    expect(body.conteos.cumplen).toBe(1); // solo c1
    expect(body.conteos.revisar).toBe(2); // c3 y c4 (sin mínimo tampoco cumple)
    expect(body.conteos["sin-minimo"]).toBe(1); // solo c4
    expect(body.conteos["solo-ml"]).toBe(1); // solo c5
    expect(body.conteos.aprobadas).toBe(1); // c2
    expect(body.conteos.rechazadas).toBe(0);
  });

  it("filtro inválido: cae a 'todas', nunca lanza", async () => {
    filasPorTabla.set(promocionesCandidatos, [candidatoFila()]);
    filasPorTabla.set(promocionesAcciones, []);
    const res = await GET(peticion("no-existe"));
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.filas).toHaveLength(1);
  });

  it("cuentaId con formato inválido: 400", async () => {
    const res = await GET(new Request("https://staging.test/api/ml/promociones/candidatos?cuentaId=no-es-un-uuid"));
    expect(res.status).toBe(400);
  });
});
