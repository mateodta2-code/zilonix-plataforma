import { randomUUID } from "crypto";
import { and, eq } from "drizzle-orm";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { dbComoEmpresa } from "@/db/empresa-context";
import { db } from "@/db/index";
import { cuentasMl, empresas, seguimientoAlertas, seguimientoFotos, seguimientosMl, usuarios } from "@/db/schema";
import { cifrarToken } from "@/lib/cifrado";
import { LimiteMercadoLibreError } from "@/lib/ml/cliente";
import { leerConReintento429, revisarSeguimientosDelDia } from "./revisionDiariaSeguimiento";

// Issue #175 — el reintento con espera en 429 se prueba SOLO (mockea
// lib/seguimiento/lector.ts, vi.useFakeTimers()): no tiene nada que ver
// con Postgres, probarlo contra la base real solo lo haría lento sin
// agregar ninguna garantía más.
vi.mock("@/lib/seguimiento/lector", () => ({ leerFotoSeguimiento: vi.fn() }));

describe("leerConReintento429 — reintento con espera creciente en 429 (issue #175)", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("429 dos veces y OK a la tercera: reintenta con espera creciente, sin fallar", async () => {
    const { leerFotoSeguimiento } = await import("@/lib/seguimiento/lector");
    const datosFinal = { precio: 100, precioAnterior: null, inventarioDisponible: null, inventarioAproximado: false, vendidos: null, estado: null, enCatalogo: null, ganaBotonCompra: null, esFull: null, esEnvioGratis: null, publicaciones: null };
    vi.mocked(leerFotoSeguimiento)
      .mockRejectedValueOnce(new LimiteMercadoLibreError())
      .mockRejectedValueOnce(new LimiteMercadoLibreError())
      .mockResolvedValueOnce(datosFinal);

    vi.useFakeTimers();
    const promesa = leerConReintento429({ tipo: "producto", recursoMl: "item", mlIdExterno: "MCO111" }, "token", "123");
    await vi.runAllTimersAsync();
    const resultado = await promesa;

    expect(resultado).toEqual(datosFinal);
    expect(leerFotoSeguimiento).toHaveBeenCalledTimes(3);
  });

  it("429 todas las veces (más de lo que se reintenta): termina lanzando LimiteMercadoLibreError", async () => {
    const { leerFotoSeguimiento } = await import("@/lib/seguimiento/lector");
    vi.mocked(leerFotoSeguimiento).mockRejectedValue(new LimiteMercadoLibreError());

    vi.useFakeTimers();
    const promesa = leerConReintento429({ tipo: "producto", recursoMl: "item", mlIdExterno: "MCO111" }, "token", "123").catch((e) => e);
    await vi.runAllTimersAsync();
    const resultado = await promesa;

    expect(resultado).toBeInstanceOf(LimiteMercadoLibreError);
  });

  it("un error que no es 429 nunca se reintenta — sube de una", async () => {
    const { leerFotoSeguimiento } = await import("@/lib/seguimiento/lector");
    const otroError = new Error("otra cosa");
    vi.mocked(leerFotoSeguimiento).mockRejectedValue(otroError);

    await expect(leerConReintento429({ tipo: "producto", recursoMl: "item", mlIdExterno: "MCO111" }, "token", "123")).rejects.toBe(otroError);
    expect(leerFotoSeguimiento).toHaveBeenCalledTimes(1);
  });
});

function respuestaJson(data: unknown, status = 200) {
  return { ok: status >= 200 && status < 300, status, json: async () => data, text: async () => JSON.stringify(data) } as Response;
}

// Issue #175 — prueba real contra Postgres (mismo criterio que
// lib/ml/trabajador.test.ts): dbTrabajadorSeguimiento lee seguimientos
// de CUALQUIER empresa (cross-empresa, a propósito), dbComoEmpresa/
// app_user hace el resto una vez resuelta la empresa. Solo el fetch a
// Mercado Libre se simula.
describe("revisarSeguimientosDelDia (issue #175)", () => {
  const empresaId = randomUUID();
  let seguimientoId: string;
  const itemId = `MCO${randomUUID().replace(/-/g, "").slice(0, 10)}`;

  beforeAll(async () => {
    await dbComoEmpresa(empresaId, (tx) =>
      tx.insert(empresas).values({ id: empresaId, nombre: "Empresa revisión diaria", nit: `TEST-REV-${empresaId.slice(0, 8)}` })
    );
    await dbComoEmpresa(empresaId, (tx) =>
      tx.insert(cuentasMl).values({
        empresaId,
        cuentaIdExterna: `${Date.now()}`,
        nickname: "VENDEDOR_REVISION",
        accessTokenCifrado: cifrarToken("access-vigente"),
        refreshTokenCifrado: cifrarToken("refresh"),
        tokenExpiraTs: new Date(Date.now() + 3600_000), // vigente — no debería intentar renovar
      })
    );

    // usuarios no lleva RLS (tarea 1.3) — se inserta con la conexión
    // normal de app_user, igual que db/test-utils/aislamiento.ts.
    const [usuario] = await db
      .insert(usuarios)
      .values({ email: `prueba-revision-diaria-${empresaId}@zilonix.test`, nombre: "Usuario de prueba" })
      .returning({ id: usuarios.id });

    const [seguimiento] = await dbComoEmpresa(empresaId, (tx) =>
      tx
        .insert(seguimientosMl)
        .values({
          empresaId,
          tipo: "producto",
          recursoMl: "item",
          mlIdExterno: itemId,
          nombre: "Producto de prueba",
          linkOriginal: "https://articulo.mercadolibre.com.co/MCO-1",
          creadoPor: usuario.id,
        })
        .returning({ id: seguimientosMl.id })
    );
    seguimientoId = seguimiento.id;

    // Foto de "ayer" insertada directo (nunca a través del trabajo):
    // precio 100, vendidos 10 — la de "hoy" (simulada con fetch abajo)
    // trae precio 80 y vendidos 15, para disparar precio_bajo y
    // vendio_unidades al compararlas.
    const ayer = new Date();
    ayer.setUTCHours(0, 0, 0, 0);
    ayer.setUTCDate(ayer.getUTCDate() - 1);
    await dbComoEmpresa(empresaId, (tx) =>
      tx.insert(seguimientoFotos).values({
        empresaId,
        seguimientoId,
        fecha: ayer,
        precio: "100",
        estado: "active",
        enCatalogo: false,
        vendidos: 10,
      })
    );
  });

  afterEach(() => vi.unstubAllGlobals());

  it("crea la foto de hoy y las alertas (precio_bajo, vendio_unidades) comparando con la de ayer", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        respuestaJson({
          price: 80,
          sold_quantity: 15,
          status: "active",
          catalog_listing: false,
        })
      )
    );

    const resultado = await revisarSeguimientosDelDia();

    expect(resultado.fallidos).toBe(0);
    expect(resultado.procesados).toBeGreaterThanOrEqual(1);

    const hoy = new Date();
    hoy.setUTCHours(0, 0, 0, 0);
    const [fotoHoy] = await dbComoEmpresa(empresaId, (tx) =>
      tx.select().from(seguimientoFotos).where(and(eq(seguimientoFotos.seguimientoId, seguimientoId), eq(seguimientoFotos.fecha, hoy)))
    );
    expect(fotoHoy).toBeDefined();
    expect(fotoHoy.vendidos).toBe(15);

    const alertas = await dbComoEmpresa(empresaId, (tx) => tx.select().from(seguimientoAlertas).where(eq(seguimientoAlertas.seguimientoId, seguimientoId)));
    expect(alertas.map((a) => a.tipo).sort()).toEqual(["precio_bajo", "vendio_unidades"]);

    const [seguimientoActualizado] = await dbComoEmpresa(empresaId, (tx) => tx.select().from(seguimientosMl).where(eq(seguimientosMl.id, seguimientoId)));
    expect(seguimientoActualizado.ultimaRevisionTs).not.toBeNull();
  });

  it("corrida repetida el mismo día: no duplica la foto ni crea alertas de más (índice único por día)", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => respuestaJson({ price: 999, status: "active" }))); // si duplicara, este precio lo delataría

    await revisarSeguimientosDelDia();

    const hoy = new Date();
    hoy.setUTCHours(0, 0, 0, 0);
    const fotosDeHoy = await dbComoEmpresa(empresaId, (tx) =>
      tx.select().from(seguimientoFotos).where(and(eq(seguimientoFotos.seguimientoId, seguimientoId), eq(seguimientoFotos.fecha, hoy)))
    );
    expect(fotosDeHoy).toHaveLength(1);
    expect(Number(fotosDeHoy[0].precio)).toBe(80); // la de la corrida anterior, nunca 999
  });
});
