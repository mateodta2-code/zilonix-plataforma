import { randomUUID } from "crypto";
import { and, eq, isNull, like } from "drizzle-orm";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { dbComoEmpresa } from "@/db/empresa-context";
import { avisosMl, cuentasMl, empresas } from "@/db/schema";
import { cifrarToken } from "@/lib/cifrado";
import { procesarAvisosPendientes } from "./trabajador";

function respuestaOk(data: unknown = {}) {
  return { ok: true, status: 200, json: async () => data, text: async () => JSON.stringify(data) } as Response;
}
function respuesta404() {
  return { ok: false, status: 404, json: async () => ({}), text: async () => "not found" } as Response;
}

// Tarea 2.4 — prueba real contra Postgres: el trabajador lee avisos
// pendientes de CUALQUIER empresa (trabajador_user, cross-empresa a
// propósito), vuelve a pedirle el dato real a la API (acá, simulada con
// fetch mockeado — la prueba de carga de verdad contra la API real de
// Mercado Libre la corre Mateo en staging, no CI) y marca procesado_ts.
describe("trabajador de avisos de Mercado Libre (tarea 2.4)", () => {
  const empresaId = randomUUID();
  const cuentaExterna = `ml-user-trabajador-${randomUUID()}`;

  beforeAll(async () => {
    await dbComoEmpresa(empresaId, (tx) =>
      tx.insert(empresas).values({ id: empresaId, nombre: "Empresa trabajador (prueba 2.4)", nit: `TEST-TRAB-${empresaId.slice(0, 8)}` })
    );
    await dbComoEmpresa(empresaId, (tx) =>
      tx.insert(cuentasMl).values({
        empresaId,
        cuentaIdExterna: cuentaExterna,
        nickname: "VENDEDOR_TRABAJADOR",
        accessTokenCifrado: cifrarToken("access-vigente"),
        refreshTokenCifrado: cifrarToken("refresh"),
        tokenExpiraTs: new Date(Date.now() + 3600_000), // vigente — no debería intentar renovar
      })
    );
  });

  // Contra la base real (CI: Postgres efímero en el mismo runner, rápido;
  // staging manual: por un túnel SSH, con latencia real) — 15s de
  // margen para las pruebas puntuales, de sobra en cualquiera de los dos.
  vi.setConfig({ testTimeout: 15_000 });

  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(respuestaOk({ id: 123, status: "paid" })));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("procesa un aviso pendiente: consulta la API real y marca procesado_ts", async () => {
    await dbComoEmpresa(empresaId, (tx) =>
      tx.insert(avisosMl).values({
        empresaId,
        cuentaIdExterna: cuentaExterna,
        topic: "orders_v2",
        resource: "/orders/111",
        enviadoTs: new Date(),
      })
    );

    const resultado = await procesarAvisosPendientes();
    expect(resultado.procesados).toBeGreaterThanOrEqual(1);
    expect(resultado.fallidos).toBe(0);

    const fetchMock = vi.mocked(fetch);
    expect(fetchMock).toHaveBeenCalledWith("https://api.mercadolibre.com/orders/111", expect.anything());

    const [fila] = await dbComoEmpresa(empresaId, (tx) => tx.select().from(avisosMl).where(eq(avisosMl.resource, "/orders/111")));
    expect(fila.procesadoTs).not.toBeNull();
  });

  it("un 404 de Mercado Libre (orden que nunca existió) igual cuenta como procesado, no como fallo", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(respuesta404()));
    await dbComoEmpresa(empresaId, (tx) =>
      tx.insert(avisosMl).values({
        empresaId,
        cuentaIdExterna: cuentaExterna,
        topic: "orders_v2",
        resource: "/orders/no-existe",
        enviadoTs: new Date(),
      })
    );

    const resultado = await procesarAvisosPendientes();
    expect(resultado.fallidos).toBe(0);

    const [fila] = await dbComoEmpresa(empresaId, (tx) => tx.select().from(avisosMl).where(eq(avisosMl.resource, "/orders/no-existe")));
    expect(fila.procesadoTs).not.toBeNull();
  });

  it("un error real de Mercado Libre (ej. 500) deja el aviso pendiente para reintentar, no lo marca procesado", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: false, status: 500, text: async () => "error interno" } as Response)
    );
    await dbComoEmpresa(empresaId, (tx) =>
      tx.insert(avisosMl).values({
        empresaId,
        cuentaIdExterna: cuentaExterna,
        topic: "orders_v2",
        resource: "/orders/con-error",
        enviadoTs: new Date(),
      })
    );

    const resultado = await procesarAvisosPendientes();
    expect(resultado.fallidos).toBeGreaterThanOrEqual(1);

    const [fila] = await dbComoEmpresa(empresaId, (tx) => tx.select().from(avisosMl).where(eq(avisosMl.resource, "/orders/con-error")));
    expect(fila.procesadoTs).toBeNull(); // sigue pendiente, no se perdió
  });

  it("carga real: 1.000 avisos pendientes se procesan todos en lotes, 0 perdidos", async () => {
    const PREFIJO = `carga-${randomUUID()}-`; // única por corrida, para distinguir estos 1.000 de cualquier otro aviso pendiente que deje otra prueba en la misma base compartida de CI
    const valores = Array.from({ length: 1000 }, (_, i) => ({
      empresaId,
      cuentaIdExterna: cuentaExterna,
      topic: "orders_v2",
      resource: `/orders/${PREFIJO}${i}`,
      enviadoTs: new Date(Date.now() - i), // cada uno con un momento de envío distinto, por el índice único
    }));
    // Insertar de a 100 — un solo INSERT de 1.000 filas es más lento de
    // lo necesario para esta prueba y no aporta nada extra.
    for (let i = 0; i < valores.length; i += 100) {
      await dbComoEmpresa(empresaId, (tx) => tx.insert(avisosMl).values(valores.slice(i, i + 100)));
    }

    // El trabajador real corre en lotes (TAMAÑO_LOTE=50) disparado por
    // un cron cada minuto — acá se simula esa secuencia de pasadas
    // hasta vaciar la cola, en vez de esperar 20 minutos de verdad.
    // OJO: procesarAvisosPendientes() barre avisos de CUALQUIER empresa
    // a propósito (ver lib/ml/trabajador.ts) — en esta base compartida
    // de CI, otra prueba (ej. "un error real" de arriba, que deja un
    // aviso pendiente a propósito) puede sumar a los contadores de cada
    // pasada. Por eso la prueba real no es el conteo global, sino
    // confirmar puntualmente que ESTOS 1.000 (por el prefijo único)
    // quedaron todos procesados.
    for (let pasada = 0; pasada < 25; pasada++) {
      const resultado = await procesarAvisosPendientes();
      if (resultado.recibidosPendientes === 0) break;
    }

    const pendientesDeEstaCarga = await dbComoEmpresa(empresaId, (tx) =>
      tx.select({ id: avisosMl.id }).from(avisosMl).where(and(isNull(avisosMl.procesadoTs), like(avisosMl.resource, `/orders/${PREFIJO}%`)))
    );
    expect(pendientesDeEstaCarga).toHaveLength(0); // 0 perdidos, de los 1.000 propios

    const procesadosDeEstaCarga = await dbComoEmpresa(empresaId, (tx) =>
      tx.select({ id: avisosMl.id }).from(avisosMl).where(like(avisosMl.resource, `/orders/${PREFIJO}%`))
    );
    expect(procesadosDeEstaCarga).toHaveLength(1000); // los 1.000 están, ninguno se perdió en el camino
  }, 120_000);
});
