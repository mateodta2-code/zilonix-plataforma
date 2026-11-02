import { randomUUID } from "crypto";
import { and, eq, isNull, like } from "drizzle-orm";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { dbComoEmpresa } from "@/db/empresa-context";
import { avisosMl, cuentasMl, despachosMl, empresas, pedidos } from "@/db/schema";
import { crearCuentaMlDePrueba } from "@/db/test-utils/venta";
import { cifrarToken } from "@/lib/cifrado";
import { intentarProcesarAvisoAhora, procesarAvisosPendientes } from "./trabajador";

function respuestaOk(data: unknown = {}) {
  return { ok: true, status: 200, json: async () => data, text: async () => JSON.stringify(data) } as Response;
}
function respuesta404() {
  return { ok: false, status: 404, json: async () => ({}), text: async () => "not found" } as Response;
}

const sinEspera = async () => {};

// Tarea 2.4 — prueba real contra Postgres: el trabajador lee avisos
// pendientes de CUALQUIER empresa (trabajador_user, cross-empresa a
// propósito), vuelve a pedirle el dato real a la API (acá, simulada con
// fetch mockeado — la prueba de carga de verdad contra la API real de
// Mercado Libre la corre Mateo en staging, no CI) y marca procesado_ts.
// Tema "items" (nunca "orders_v2"/"shipments") a propósito en este
// describe: issue "ventas nuevas en segundos" (Refs #49) — esos dos SÍ
// escriben pedidos/despachos_ml ahora (su propio describe, más abajo);
// "items" (y cualquier otro tema) sigue con el comportamiento de
// siempre, el que prueba este describe: solo confirma que el recurso
// es real y accesible.
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
        topic: "items",
        resource: "/items/111",
        enviadoTs: new Date(),
      })
    );

    const resultado = await procesarAvisosPendientes(sinEspera);
    expect(resultado.procesados).toBeGreaterThanOrEqual(1);
    expect(resultado.fallidos).toBe(0);

    const fetchMock = vi.mocked(fetch);
    expect(fetchMock).toHaveBeenCalledWith("https://api.mercadolibre.com/items/111", expect.anything());

    const [fila] = await dbComoEmpresa(empresaId, (tx) => tx.select().from(avisosMl).where(eq(avisosMl.resource, "/items/111")));
    expect(fila.procesadoTs).not.toBeNull();
  });

  it("un 404 de Mercado Libre (orden que nunca existió) igual cuenta como procesado, no como fallo", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(respuesta404()));
    await dbComoEmpresa(empresaId, (tx) =>
      tx.insert(avisosMl).values({
        empresaId,
        cuentaIdExterna: cuentaExterna,
        topic: "items",
        resource: "/items/no-existe",
        enviadoTs: new Date(),
      })
    );

    const resultado = await procesarAvisosPendientes(sinEspera);
    expect(resultado.fallidos).toBe(0);

    const [fila] = await dbComoEmpresa(empresaId, (tx) => tx.select().from(avisosMl).where(eq(avisosMl.resource, "/items/no-existe")));
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
        topic: "items",
        resource: "/items/con-error",
        enviadoTs: new Date(),
      })
    );

    const resultado = await procesarAvisosPendientes(sinEspera);
    expect(resultado.fallidos).toBeGreaterThanOrEqual(1);

    const [fila] = await dbComoEmpresa(empresaId, (tx) => tx.select().from(avisosMl).where(eq(avisosMl.resource, "/items/con-error")));
    expect(fila.procesadoTs).toBeNull(); // sigue pendiente, no se perdió
  });

  it("carga real: 1.000 avisos pendientes se procesan todos en lotes, 0 perdidos", async () => {
    const PREFIJO = `carga-${randomUUID()}-`; // única por corrida, para distinguir estos 1.000 de cualquier otro aviso pendiente que deje otra prueba en la misma base compartida de CI
    const valores = Array.from({ length: 1000 }, (_, i) => ({
      empresaId,
      cuentaIdExterna: cuentaExterna,
      topic: "items",
      resource: `/items/${PREFIJO}${i}`,
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
      const resultado = await procesarAvisosPendientes(sinEspera);
      if (resultado.recibidosPendientes === 0) break;
    }

    const pendientesDeEstaCarga = await dbComoEmpresa(empresaId, (tx) =>
      tx.select({ id: avisosMl.id }).from(avisosMl).where(and(isNull(avisosMl.procesadoTs), like(avisosMl.resource, `/items/${PREFIJO}%`)))
    );
    expect(pendientesDeEstaCarga).toHaveLength(0); // 0 perdidos, de los 1.000 propios

    const procesadosDeEstaCarga = await dbComoEmpresa(empresaId, (tx) =>
      tx.select({ id: avisosMl.id }).from(avisosMl).where(like(avisosMl.resource, `/items/${PREFIJO}%`))
    );
    expect(procesadosDeEstaCarga).toHaveLength(1000); // los 1.000 están, ninguno se perdió en el camino
  }, 120_000);
});

// Issue "ventas nuevas en segundos" (Refs #49) — helpers compartidos
// por este describe y por el de intentarProcesarAvisoAhora, más abajo
// (mismo tipo de orden/envío simulados, nada propio de cada uno).
async function empresaConCuenta(nombre: string) {
  const empresaId = randomUUID();
  await dbComoEmpresa(empresaId, (tx) => tx.insert(empresas).values({ id: empresaId, nombre, nit: `TEST-AVTX-${empresaId.slice(0, 8)}` }));
  const cuentaId = await crearCuentaMlDePrueba(empresaId);
  const [cuenta] = await dbComoEmpresa(empresaId, (tx) => tx.select({ cuentaIdExterna: cuentasMl.cuentaIdExterna }).from(cuentasMl).where(eq(cuentasMl.id, cuentaId)));
  return { empresaId, cuentaId, cuentaExterna: cuenta.cuentaIdExterna };
}

function orden(id: number, shipmentId: number) {
  return {
    id,
    date_created: "2026-10-30T10:00:00.000-05:00",
    status: "paid",
    total_amount: 80000,
    currency_id: "COP",
    shipping: { id: shipmentId },
    payments: [{ status: "approved", date_approved: "2026-10-30T10:05:00.000-05:00", transaction_amount: 80000 }],
    order_items: [{ item: { id: `MCO${id}`, title: `Producto ${id}`, seller_sku: "AVISO-1" }, quantity: 1, unit_price: 80000 }],
  };
}

function mockFetchOrdenYEnvio(orderId: number, shipmentId: number) {
  return vi.fn(async (url: string) => {
    const u = new URL(url);
    if (u.pathname === `/orders/${orderId}`) return respuestaOk(orden(orderId, shipmentId));
    if (u.pathname === `/shipments/${shipmentId}`) return respuestaOk({ order_id: orderId, status: "ready_to_ship", substatus: null, logistic_type: "xd_drop_off" });
    if (u.pathname === `/shipments/${shipmentId}/costs`) return respuestaOk({ senders: [{ cost: 0 }] });
    if (u.pathname === `/shipments/${shipmentId}/sla`) return respuestaOk({ status: "on_time", expected_date: "2026-10-31T20:00:00.000Z" });
    if (u.pathname === "/items") return respuestaOk([{ code: 200, body: { id: `MCO${orderId}` } }]);
    throw new Error(`fetch no esperado en la prueba: ${u.pathname}`);
  });
}

// Issue "ventas nuevas en segundos" (Refs #49) — "orders_v2"/"shipments"
// ahora SÍ escriben pedidos/despachos_ml, con la misma lógica real que
// sincronizarVentasCuenta (lib/ml/ventas-finanzas.ts) y el fix del
// PR #345 (shipmentId resuelto por guardarOrdenMl, nunca adivinado con
// el contenido del aviso).
describe("trabajador — orders_v2/shipments sincronizan pedidos/despachos_ml (issue 'ventas nuevas en segundos')", () => {
  vi.setConfig({ testTimeout: 15_000 });

  it("aviso 'orders_v2' de una orden nueva crea el pedido Y su despacho (shipmentId resuelto por guardarOrdenMl, nunca adivinado)", async () => {
    const { empresaId, cuentaExterna } = await empresaConCuenta("Empresa aviso orders_v2");
    const orderId = 601;
    const shipmentId = 5601;
    vi.stubGlobal("fetch", mockFetchOrdenYEnvio(orderId, shipmentId));

    await dbComoEmpresa(empresaId, (tx) =>
      tx.insert(avisosMl).values({ empresaId, cuentaIdExterna: cuentaExterna, topic: "orders_v2", resource: `/orders/${orderId}`, enviadoTs: new Date() })
    );

    const resultado = await procesarAvisosPendientes(sinEspera);
    expect(resultado).toMatchObject({ procesados: 1, fallidos: 0 });

    const [filaPedido] = await dbComoEmpresa(empresaId, (tx) => tx.select().from(pedidos).where(eq(pedidos.pedidoIdExterno, String(orderId))));
    expect(filaPedido).toBeDefined();

    const [filaDespacho] = await dbComoEmpresa(empresaId, (tx) => tx.select().from(despachosMl).where(eq(despachosMl.pedidoId, filaPedido.id)));
    expect(filaDespacho).toMatchObject({ shipmentIdExterno: String(shipmentId), status: "ready_to_ship", logisticType: "xd_drop_off" });

    const [filaAviso] = await dbComoEmpresa(empresaId, (tx) => tx.select().from(avisosMl).where(eq(avisosMl.resource, `/orders/${orderId}`)));
    expect(filaAviso.procesadoTs).not.toBeNull();
  });

  it("aviso 'shipments' resuelve el order_id real (del envío, nunca del contenido del aviso) y sincroniza lo mismo", async () => {
    const { empresaId, cuentaExterna } = await empresaConCuenta("Empresa aviso shipments");
    const orderId = 602;
    const shipmentId = 5602;
    vi.stubGlobal("fetch", mockFetchOrdenYEnvio(orderId, shipmentId));

    await dbComoEmpresa(empresaId, (tx) =>
      tx.insert(avisosMl).values({ empresaId, cuentaIdExterna: cuentaExterna, topic: "shipments", resource: `/shipments/${shipmentId}`, enviadoTs: new Date() })
    );

    const resultado = await procesarAvisosPendientes(sinEspera);
    expect(resultado).toMatchObject({ procesados: 1, fallidos: 0 });

    const [filaPedido] = await dbComoEmpresa(empresaId, (tx) => tx.select().from(pedidos).where(eq(pedidos.pedidoIdExterno, String(orderId))));
    expect(filaPedido).toBeDefined();
    const [filaDespacho] = await dbComoEmpresa(empresaId, (tx) => tx.select().from(despachosMl).where(eq(despachosMl.pedidoId, filaPedido.id)));
    expect(filaDespacho.shipmentIdExterno).toBe(String(shipmentId));
  });

  it("dos avisos de la MISMA orden (ej. creada y actualizada) nunca duplican el pedido ni el despacho", async () => {
    const { empresaId, cuentaExterna } = await empresaConCuenta("Empresa aviso duplicado");
    const orderId = 603;
    const shipmentId = 5603;
    vi.stubGlobal("fetch", mockFetchOrdenYEnvio(orderId, shipmentId));

    await dbComoEmpresa(empresaId, (tx) =>
      tx.insert(avisosMl).values([
        { empresaId, cuentaIdExterna: cuentaExterna, topic: "orders_v2", resource: `/orders/${orderId}`, enviadoTs: new Date(Date.now() - 2000) },
        { empresaId, cuentaIdExterna: cuentaExterna, topic: "orders_v2", resource: `/orders/${orderId}`, enviadoTs: new Date() },
      ])
    );

    const resultado = await procesarAvisosPendientes(sinEspera);
    expect(resultado).toMatchObject({ recibidosPendientes: 2, procesados: 2, fallidos: 0 });

    const filasPedido = await dbComoEmpresa(empresaId, (tx) => tx.select().from(pedidos).where(eq(pedidos.pedidoIdExterno, String(orderId))));
    expect(filasPedido).toHaveLength(1); // nunca dos pedidos por la misma orden

    const filasDespacho = await dbComoEmpresa(empresaId, (tx) => tx.select().from(despachosMl).where(eq(despachosMl.pedidoId, filasPedido[0].id)));
    expect(filasDespacho).toHaveLength(1); // nunca dos despachos tampoco
  });
});

// Issue "despachos no aparecen solos" (Refs #49) — intentarProcesarAvisoAhora
// es la mitad que llama el webhook (app/api/ml/webhooks/route.ts) justo
// después de guardar el aviso, para que la venta se vea en Despachos en
// segundos en vez de esperar al cron. Mismo motor real que
// procesarAvisosPendientes (sincronizarVentaDesdeAviso) — lo propio de
// acá es el reclamo atómico (nunca procesa dos veces el mismo aviso) y
// el tope de tiempo (nunca bloquea el 200 que espera Mercado Libre).
describe("intentarProcesarAvisoAhora (webhook, issue 'despachos no aparecen solos')", () => {
  vi.setConfig({ testTimeout: 15_000 });

  it("procesa 'orders_v2' al instante: pedido y despacho quedan listos antes de responder", async () => {
    const { empresaId, cuentaExterna } = await empresaConCuenta("Empresa aviso instantaneo (webhook)");
    const orderId = 700;
    const shipmentId = 5700;
    vi.stubGlobal("fetch", mockFetchOrdenYEnvio(orderId, shipmentId));

    const [{ id: avisoId }] = await dbComoEmpresa(empresaId, (tx) =>
      tx
        .insert(avisosMl)
        .values({ empresaId, cuentaIdExterna: cuentaExterna, topic: "orders_v2", resource: `/orders/${orderId}`, enviadoTs: new Date() })
        .returning({ id: avisosMl.id })
    );

    const resultado = await intentarProcesarAvisoAhora(avisoId);
    expect(resultado).toBe("procesado");

    const [filaPedido] = await dbComoEmpresa(empresaId, (tx) => tx.select().from(pedidos).where(eq(pedidos.pedidoIdExterno, String(orderId))));
    expect(filaPedido).toBeDefined();
    const [filaDespacho] = await dbComoEmpresa(empresaId, (tx) => tx.select().from(despachosMl).where(eq(despachosMl.pedidoId, filaPedido.id)));
    expect(filaDespacho).toMatchObject({ shipmentIdExterno: String(shipmentId) });

    const [filaAviso] = await dbComoEmpresa(empresaId, (tx) => tx.select().from(avisosMl).where(eq(avisosMl.id, avisoId)));
    expect(filaAviso.procesadoTs).not.toBeNull();
  });

  it("si Mercado Libre tarda más que el tope, el aviso queda pendiente para el cron de respaldo (nunca bloquea el 200)", async () => {
    const { empresaId, cuentaExterna } = await empresaConCuenta("Empresa aviso lento (timeout webhook)");
    const orderId = 701;
    const shipmentId = 5701;
    const DEMORA_MS = 200;
    const respuestaDelMock = mockFetchOrdenYEnvio(orderId, shipmentId);
    let primeraLlamada = true;
    vi.stubGlobal(
      "fetch",
      // Solo la PRIMERA llamada (la que de verdad compite contra el
      // tope) se demora — así el trabajo de fondo (que sigue corriendo
      // sin que nadie lo espere tras el timeout) termina rápido después,
      // en vez de arrastrar la demora en cada una de sus llamadas
      // encadenadas (orden, envío, costos, SLA) y quedar corriendo
      // todavía cuando empiece la siguiente prueba.
      vi.fn(async (url: string) => {
        if (primeraLlamada) {
          primeraLlamada = false;
          await new Promise((r) => setTimeout(r, DEMORA_MS));
        }
        return respuestaDelMock(url);
      })
    );

    const [{ id: avisoId }] = await dbComoEmpresa(empresaId, (tx) =>
      tx
        .insert(avisosMl)
        .values({ empresaId, cuentaIdExterna: cuentaExterna, topic: "orders_v2", resource: `/orders/${orderId}`, enviadoTs: new Date() })
        .returning({ id: avisosMl.id })
    );

    // Tope artificialmente chico (30ms, mucho menos que DEMORA_MS) solo
    // para la prueba — en producción es TIMEOUT_PROCESO_WEBHOOK_MS (5s).
    const resultado = await intentarProcesarAvisoAhora(avisoId, 30);
    expect(resultado).toBe("pendiente");

    const [filaAviso] = await dbComoEmpresa(empresaId, (tx) => tx.select().from(avisosMl).where(eq(avisosMl.id, avisoId)));
    expect(filaAviso.procesadoTs).toBeNull(); // liberado, nunca se queda "a medias"

    // Deja terminar el trabajo de fondo (ya nadie lo espera) antes de
    // que acabe la prueba, para no dejarlo correr suelto hacia la
    // siguiente (que ya tendría otro fetch mockeado con otra orden).
    await new Promise((r) => setTimeout(r, DEMORA_MS + 150));
  });

  it("si la cuenta ya no está conectada a la empresa, nunca llama a Mercado Libre y deja el aviso pendiente", async () => {
    const { empresaId } = await empresaConCuenta("Empresa cuenta desconectada (webhook)");
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const cuentaIdExternaAjena = `ml-user-ajena-${randomUUID()}`; // nunca se conectó a esta empresa
    const [{ id: avisoId }] = await dbComoEmpresa(empresaId, (tx) =>
      tx
        .insert(avisosMl)
        .values({ empresaId, cuentaIdExterna: cuentaIdExternaAjena, topic: "orders_v2", resource: "/orders/999999", enviadoTs: new Date() })
        .returning({ id: avisosMl.id })
    );

    const resultado = await intentarProcesarAvisoAhora(avisoId);
    expect(resultado).toBe("pendiente");
    expect(fetchMock).not.toHaveBeenCalled(); // nunca confía en el aviso, y sin cuenta no hay con qué pedirle nada a ML

    const [filaAviso] = await dbComoEmpresa(empresaId, (tx) => tx.select().from(avisosMl).where(eq(avisosMl.id, avisoId)));
    expect(filaAviso.procesadoTs).toBeNull();
  });

  it("si el aviso ya fue reclamado (ej. el cron llegó primero), el webhook nunca lo vuelve a procesar", async () => {
    const { empresaId, cuentaExterna } = await empresaConCuenta("Empresa aviso ya reclamado (idempotencia)");
    const orderId = 702;
    const shipmentId = 5702;
    const fetchMock = mockFetchOrdenYEnvio(orderId, shipmentId);
    vi.stubGlobal("fetch", fetchMock);

    const [{ id: avisoId }] = await dbComoEmpresa(empresaId, (tx) =>
      tx
        .insert(avisosMl)
        .values({ empresaId, cuentaIdExterna: cuentaExterna, topic: "orders_v2", resource: `/orders/${orderId}`, enviadoTs: new Date() })
        .returning({ id: avisosMl.id })
    );
    // Simula al cron reclamando el aviso primero — mismo UPDATE atómico
    // que usa intentarProcesarAvisoAhora (reclamarAviso).
    await dbComoEmpresa(empresaId, (tx) => tx.update(avisosMl).set({ procesadoTs: new Date() }).where(eq(avisosMl.id, avisoId)));

    const resultado = await intentarProcesarAvisoAhora(avisoId);
    expect(resultado).toBe("omitido");
    expect(fetchMock).not.toHaveBeenCalled(); // nunca vuelve a pedirle nada a Mercado Libre

    const [filaPedido] = await dbComoEmpresa(empresaId, (tx) => tx.select().from(pedidos).where(eq(pedidos.pedidoIdExterno, String(orderId))));
    expect(filaPedido).toBeUndefined(); // el webhook no creó nada por su cuenta
  });
});
