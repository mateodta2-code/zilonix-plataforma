import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Mismo patrón que app/api/ml/promociones/buscar/route.test.ts — se
// mockean las piezas que SÍ tocan Postgres/sesión, nunca la lógica
// pura (lib/roles-plantillas.tienePermiso corre real, es un archivo
// sin ningún import de db/).
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
  return { requierePermiso: vi.fn(async () => ({ permisos: [] })), SinPermisoError };
});
vi.mock("@/lib/url-publica", () => ({ urlPublicaBase: () => "https://staging.test" }));

const { filasPorTabla, insertsPromocionesAcciones } = vi.hoisted(() => ({
  filasPorTabla: new Map<unknown, unknown[]>(),
  insertsPromocionesAcciones: [] as Record<string, unknown>[],
}));

// Mismo criterio real que lib/trabajos/buscarPromocionesMultiCuenta.test.ts
// — una "tx" mínima que devuelve lo programado POR TABLA, ignorando la
// condición real del .where() (este repo ya usa ese mismo atajo en
// varios tests). `.limit()` y el await directo del thenable cubren las
// dos formas en que la ruta real encadena la consulta.
vi.mock("@/db/empresa-context", () => ({
  dbComoEmpresa: async (_empresaId: string, fn: (tx: unknown) => unknown) => {
    const tx = {
      select: () => ({
        from: (tabla: unknown) => {
          const filas = filasPorTabla.get(tabla) ?? [];
          type Encadenable = { where: () => Encadenable; limit: (n: number) => Promise<unknown[]>; then: Promise<unknown[]>["then"] };
          const encadenable: Encadenable = {
            where: () => encadenable,
            limit: (n: number) => Promise.resolve(filas.slice(0, n)),
            then: (...args) => Promise.resolve(filas).then(...args),
          };
          return encadenable;
        },
      }),
      insert: () => ({
        values: (valores: Record<string, unknown>) => ({
          returning: async () => {
            const fila = { id: `accion-${insertsPromocionesAcciones.length + 1}`, estado: "pendiente", ...valores };
            insertsPromocionesAcciones.push(fila);
            return [fila];
          },
        }),
      }),
    };
    return fn(tx);
  },
}));

const { validarCandidatoParaEscrituraMock, ejecutarLoteDeAccionesMock } = vi.hoisted(() => ({
  validarCandidatoParaEscrituraMock: vi.fn(),
  ejecutarLoteDeAccionesMock: vi.fn(async () => {}),
}));
vi.mock("@/lib/ml/promocionesEjecucion", () => ({
  validarCandidatoParaEscritura: validarCandidatoParaEscrituraMock,
  ejecutarLoteDeAcciones: ejecutarLoteDeAccionesMock,
}));

import { cookies } from "next/headers";
import { promocionesAcciones, promocionesCandidatos } from "@/db/schema";
import { requierePermiso } from "@/lib/permisos";
import { obtenerOCrearUsuarioActual } from "@/lib/usuarios";
import { POST } from "./route";

const CANDIDATO_1 = "11111111-1111-1111-1111-111111111111";
const CANDIDATO_2 = "22222222-2222-2222-2222-222222222222";

function candidato(overrides: Record<string, unknown> = {}) {
  return {
    id: CANDIDATO_1,
    empresaId: "empresa-1",
    cuentaMlId: "cuenta-1",
    itemId: "MCO1",
    tituloProducto: "Producto",
    tipoPromocion: "DEAL",
    promotionIdMl: "promo-1",
    estadoMl: "candidate",
    precioActual: "100000",
    precioSugerido: "90000",
    ...overrides,
  };
}

function mockearCookies() {
  vi.mocked(cookies).mockReturnValue({ get: () => undefined } as unknown as ReturnType<typeof cookies>);
}

function peticion(opts: { origin?: string | null; cuerpo?: unknown } = {}): Request {
  const headers = new Headers({ "content-type": "application/json" });
  const origin = opts.origin === undefined ? "https://staging.test" : opts.origin;
  if (origin !== null) headers.set("origin", origin);
  return new Request("https://staging.test/api/ml/promociones/acciones", { method: "POST", headers, body: JSON.stringify(opts.cuerpo ?? {}) });
}

// Rama feat-promociones-aprobacion — punto 3/4: aprobar y rechazar por
// fila y en lote. El request de la UI siempre manda un solo `decision`
// para todo el lote (la vista previa separa aprobar/rechazar en dos
// flujos), pero la ruta acepta `decision` por ítem — se prueba mixto
// acá para confirmar que cada fila se procesa de forma independiente.
describe("POST /api/ml/promociones/acciones — aprobar/rechazar (rama feat-promociones-aprobacion)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockearCookies();
    vi.mocked(obtenerOCrearUsuarioActual).mockResolvedValue({ id: "usuario-1" } as never);
    vi.mocked(requierePermiso).mockResolvedValue({ permisos: [] } as never); // sin "ejecutar" por defecto
    validarCandidatoParaEscrituraMock.mockResolvedValue({ ok: true, deal: 90000 });
    filasPorTabla.clear();
    insertsPromocionesAcciones.length = 0;
  });

  afterEach(() => vi.unstubAllGlobals());

  it("Origin ajeno -> 403, nunca mira sesión", async () => {
    const res = await POST(peticion({ origin: "https://sitio-ajeno.test" }));
    expect(res.status).toBe(403);
    expect(obtenerOCrearUsuarioActual).not.toHaveBeenCalled();
  });

  it('"salir" sigue rechazado con 501 (MED 4, sin cambios)', async () => {
    filasPorTabla.set(promocionesCandidatos, [candidato()]);
    const res = await POST(peticion({ cuerpo: { decisiones: [{ candidatoId: CANDIDATO_1, accion: "salir" }] } }));
    expect(res.status).toBe(501);
    expect(validarCandidatoParaEscrituraMock).not.toHaveBeenCalled();
  });

  it("decision omitida (compatibilidad hacia atrás): se trata como 'aprobar', igual que siempre", async () => {
    filasPorTabla.set(promocionesCandidatos, [candidato()]);
    const res = await POST(peticion({ cuerpo: { decisiones: [{ candidatoId: CANDIDATO_1, accion: "participar" }] } }));
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(validarCandidatoParaEscrituraMock).toHaveBeenCalledTimes(1);
    expect(body.acciones[0].estado).toBe("aceptada");
  });

  it("decision 'aprobar' explícita: recalcula fresco con validarCandidatoParaEscritura, igual que el flujo de siempre", async () => {
    filasPorTabla.set(promocionesCandidatos, [candidato()]);
    validarCandidatoParaEscrituraMock.mockResolvedValue({ ok: true, deal: 90000 });
    const res = await POST(peticion({ cuerpo: { decisiones: [{ candidatoId: CANDIDATO_1, accion: "participar", decision: "aprobar" }] } }));
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.acciones[0].estado).toBe("aceptada");
    expect(body.acciones[0].precioDespues).toBe("90000");
  });

  // Punto 3 — "rechazar" nunca necesitó un valor de enum nuevo:
  // promocion_accion_estado ya tenía "rechazada".
  it("decision 'rechazar': NUNCA llama a validarCandidatoParaEscritura ni a Mercado Libre, guarda directo como rechazada", async () => {
    filasPorTabla.set(promocionesCandidatos, [candidato()]);
    const res = await POST(peticion({ cuerpo: { decisiones: [{ candidatoId: CANDIDATO_1, accion: "participar", decision: "rechazar" }] } }));
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(validarCandidatoParaEscrituraMock).not.toHaveBeenCalled();
    expect(ejecutarLoteDeAccionesMock).not.toHaveBeenCalled();
    expect(body.acciones[0].estado).toBe("rechazada");
    expect(body.acciones[0].precioDespues).toBeNull();
    expect(body.ejecutado).toBe(false);
  });

  it("rechazar aunque el candidato SÍ cumpliría las reglas: igual queda 'rechazada' — es una decisión humana final", async () => {
    filasPorTabla.set(promocionesCandidatos, [candidato()]);
    validarCandidatoParaEscrituraMock.mockResolvedValue({ ok: true, deal: 90000 }); // si se llamara, diría que sí cumple
    const res = await POST(peticion({ cuerpo: { decisiones: [{ candidatoId: CANDIDATO_1, accion: "participar", decision: "rechazar" }] } }));
    const body = await res.json();
    expect(body.acciones[0].estado).toBe("rechazada");
    expect(validarCandidatoParaEscrituraMock).not.toHaveBeenCalled();
  });

  it("lote mixto: una fila se aprueba y otra se rechaza, cada una de forma independiente", async () => {
    filasPorTabla.set(promocionesCandidatos, [candidato({ id: CANDIDATO_1 }), candidato({ id: CANDIDATO_2, itemId: "MCO2" })]);
    validarCandidatoParaEscrituraMock.mockResolvedValue({ ok: true, deal: 90000 });
    const res = await POST(
      peticion({
        cuerpo: {
          decisiones: [
            { candidatoId: CANDIDATO_1, accion: "participar", decision: "aprobar" },
            { candidatoId: CANDIDATO_2, accion: "participar", decision: "rechazar" },
          ],
        },
      })
    );
    const body = await res.json();
    expect(res.status).toBe(200);
    const porId = new Map(body.acciones.map((a: { id: string; estado: string }, i: number) => [i === 0 ? CANDIDATO_1 : CANDIDATO_2, a]));
    expect((porId.get(CANDIDATO_1) as { estado: string }).estado).toBe("aceptada");
    expect((porId.get(CANDIDATO_2) as { estado: string }).estado).toBe("rechazada");
    // Solo la fila aprobada pasó por el motor — la rechazada nunca.
    expect(validarCandidatoParaEscrituraMock).toHaveBeenCalledTimes(1);
  });

  it("decision inválida (ej. 'tal_vez'): 400, nunca procesa nada", async () => {
    filasPorTabla.set(promocionesCandidatos, [candidato()]);
    const res = await POST(peticion({ cuerpo: { decisiones: [{ candidatoId: CANDIDATO_1, accion: "participar", decision: "tal_vez" }] } }));
    expect(res.status).toBe(400);
    expect(insertsPromocionesAcciones).toHaveLength(0);
  });

  it("candidato rechazado con permiso de ejecutar activo: nunca se incluye en el lote que se ejecuta contra ML", async () => {
    vi.mocked(requierePermiso).mockResolvedValue({ permisos: [{ modulo: "promociones", accion: "ejecutar" }] } as never);
    filasPorTabla.set(promocionesCandidatos, [candidato()]);
    filasPorTabla.set(promocionesAcciones, []); // idempotencia / refetch final, vacío
    const res = await POST(peticion({ cuerpo: { decisiones: [{ candidatoId: CANDIDATO_1, accion: "participar", decision: "rechazar" }] } }));
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(ejecutarLoteDeAccionesMock).not.toHaveBeenCalled();
    expect(body.ejecutado).toBe(false);
  });

  // Review de Pablo (PR #304), punto 1 — tope del lote.
  describe("tope de 200 decisiones por request", () => {
    it("201 decisiones: 400 con mensaje claro, nunca procesa nada", async () => {
      const decisiones = Array.from({ length: 201 }, (_, i) => ({
        candidatoId: `${i}`.padStart(8, "0") + "-1111-1111-1111-111111111111",
        accion: "participar",
      }));
      const res = await POST(peticion({ cuerpo: { decisiones } }));
      const body = await res.json();
      expect(res.status).toBe(400);
      expect(body.error).toMatch(/200/);
      expect(insertsPromocionesAcciones).toHaveLength(0);
      expect(validarCandidatoParaEscrituraMock).not.toHaveBeenCalled();
    });

    it("exactamente 200 decisiones: pasa el tope (el límite es inclusivo)", async () => {
      filasPorTabla.set(
        promocionesCandidatos,
        Array.from({ length: 200 }, (_, i) => candidato({ id: `${i}`.padStart(8, "0") + "-1111-1111-1111-111111111111", itemId: `MCO${i}` }))
      );
      const decisiones = Array.from({ length: 200 }, (_, i) => ({
        candidatoId: `${i}`.padStart(8, "0") + "-1111-1111-1111-111111111111",
        accion: "participar",
      }));
      const res = await POST(peticion({ cuerpo: { decisiones } }));
      expect(res.status).toBe(200);
    });
  });

  // Review de Pablo (PR #304), punto 1 — dedupe por candidatoId.
  describe("dedupe por candidatoId dentro del mismo lote", () => {
    it("el mismo candidatoId dos veces en un lote: se procesa una sola vez (se queda con la primera decisión)", async () => {
      filasPorTabla.set(promocionesCandidatos, [candidato()]);
      const res = await POST(
        peticion({
          cuerpo: {
            decisiones: [
              { candidatoId: CANDIDATO_1, accion: "participar", decision: "aprobar" },
              { candidatoId: CANDIDATO_1, accion: "participar", decision: "rechazar" },
            ],
          },
        })
      );
      const body = await res.json();
      expect(res.status).toBe(200);
      expect(body.acciones).toHaveLength(1);
      expect(body.acciones[0].estado).toBe("aceptada"); // la primera decisión gana
      expect(validarCandidatoParaEscrituraMock).toHaveBeenCalledTimes(1);
      expect(insertsPromocionesAcciones).toHaveLength(1);
    });
  });

  // LOW (review de Pablo, PR #304) — rechazo duplicado por doble clic.
  describe("idempotencia de 'rechazar' entre requests separados", () => {
    it("un rechazo MUY reciente para la misma combinación: no-op, reusa la fila existente", async () => {
      const rechazoReciente = { id: "accion-previa", estado: "rechazada", creadoTs: new Date() };
      filasPorTabla.set(promocionesCandidatos, [candidato()]);
      filasPorTabla.set(promocionesAcciones, [rechazoReciente]);
      const res = await POST(peticion({ cuerpo: { decisiones: [{ candidatoId: CANDIDATO_1, accion: "participar", decision: "rechazar" }] } }));
      const body = await res.json();
      expect(res.status).toBe(200);
      expect(body.acciones[0].id).toBe("accion-previa");
      expect(insertsPromocionesAcciones).toHaveLength(0); // nunca insertó una fila nueva
    });
  });

  // Rama feat-promociones-editar-precio, punto 1 — precioElegido viaja
  // de la UI hasta validarCandidatoParaEscritura, que es la ÚNICA que
  // de verdad lo valida (piso/techo frescos) — esta ruta nunca confía
  // en el número, solo lo pasa.
  describe("precioElegido (editar precio a mano)", () => {
    it("decision 'aprobar' con precioElegido: se lo pasa a validarCandidatoParaEscritura como 4to argumento", async () => {
      filasPorTabla.set(promocionesCandidatos, [candidato()]);
      validarCandidatoParaEscrituraMock.mockResolvedValue({ ok: true, deal: 95000 });
      const res = await POST(peticion({ cuerpo: { decisiones: [{ candidatoId: CANDIDATO_1, accion: "participar", decision: "aprobar", precioElegido: 95000 }] } }));
      const body = await res.json();
      expect(res.status).toBe(200);
      expect(validarCandidatoParaEscrituraMock).toHaveBeenCalledWith("empresa-1", expect.anything(), "participar", 95000);
      expect(body.acciones[0].precioDespues).toBe("95000");
    });

    it("precioElegido con un tipo que no es número: 400, nunca procesa nada", async () => {
      filasPorTabla.set(promocionesCandidatos, [candidato()]);
      const res = await POST(peticion({ cuerpo: { decisiones: [{ candidatoId: CANDIDATO_1, accion: "participar", precioElegido: "95000" }] } }));
      expect(res.status).toBe(400);
      expect(insertsPromocionesAcciones).toHaveLength(0);
    });

    it("precioElegido junto con 'rechazar': se ignora (rechazar nunca necesita un precio)", async () => {
      filasPorTabla.set(promocionesCandidatos, [candidato()]);
      const res = await POST(peticion({ cuerpo: { decisiones: [{ candidatoId: CANDIDATO_1, accion: "participar", decision: "rechazar", precioElegido: 95000 }] } }));
      const body = await res.json();
      expect(res.status).toBe(200);
      expect(body.acciones[0].estado).toBe("rechazada");
      expect(validarCandidatoParaEscrituraMock).not.toHaveBeenCalled();
    });

    it("precioElegido inválido (NaN/piso no respetado): validarCandidatoParaEscritura lo rechaza, la fila queda 'rechazada' con el motivo", async () => {
      filasPorTabla.set(promocionesCandidatos, [candidato()]);
      validarCandidatoParaEscrituraMock.mockResolvedValue({ ok: false, motivo: "El precio elegido no es válido o quedó por debajo del piso de Finanzas — no se escribe en Mercado Libre." });
      const res = await POST(peticion({ cuerpo: { decisiones: [{ candidatoId: CANDIDATO_1, accion: "participar", precioElegido: 1000 }] } }));
      const body = await res.json();
      expect(body.acciones[0].estado).toBe("rechazada");
      expect(body.acciones[0].error).toContain("piso");
    });
  });

  // Rama feat-promociones-editar-precio, punto 2 — "Volver a pendiente".
  describe("decision 'volver_a_pendiente'", () => {
    it("inserta una fila nueva con estado 'pendiente', nunca valida ni toca Mercado Libre", async () => {
      filasPorTabla.set(promocionesCandidatos, [candidato()]);
      const res = await POST(peticion({ cuerpo: { decisiones: [{ candidatoId: CANDIDATO_1, accion: "participar", decision: "volver_a_pendiente" }] } }));
      const body = await res.json();
      expect(res.status).toBe(200);
      expect(body.acciones[0].estado).toBe("pendiente");
      expect(validarCandidatoParaEscrituraMock).not.toHaveBeenCalled();
      expect(ejecutarLoteDeAccionesMock).not.toHaveBeenCalled();
      expect(insertsPromocionesAcciones).toHaveLength(1);
    });

    it("nunca se agrupa con el lote que se ejecuta contra ML, aunque quien llama tenga permiso de ejecutar", async () => {
      vi.mocked(requierePermiso).mockResolvedValue({ permisos: [{ modulo: "promociones", accion: "ejecutar" }] } as never);
      filasPorTabla.set(promocionesCandidatos, [candidato()]);
      filasPorTabla.set(promocionesAcciones, []);
      const res = await POST(peticion({ cuerpo: { decisiones: [{ candidatoId: CANDIDATO_1, accion: "participar", decision: "volver_a_pendiente" }] } }));
      const body = await res.json();
      expect(body.ejecutado).toBe(false);
      expect(ejecutarLoteDeAccionesMock).not.toHaveBeenCalled();
    });
  });
});
