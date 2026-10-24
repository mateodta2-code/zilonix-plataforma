import { randomUUID } from "crypto";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { dbComoEmpresa } from "@/db/empresa-context";
import { cuentasMl, despachosMl, empresas, pedidos } from "@/db/schema";
import { cifrarToken } from "@/lib/cifrado";
import { listarPedidosFiltrados, obtenerPedidoConEventos, PASOS_PEDIDO, registrarEventoPedido } from "./pedidos";

// Tarea 2.7 — prueba real contra Postgres: los eventos de un pedido
// respetan el aislamiento de siempre, nunca se duplica un paso, y la
// línea de tiempo siempre sale en el orden fijo de los 8 pasos.
describe("pedidos y línea de tiempo (tarea 2.7)", () => {
  const empresaAId = randomUUID();
  const empresaBId = randomUUID();
  let pedidoId: string;

  beforeAll(async () => {
    await dbComoEmpresa(empresaAId, (tx) =>
      tx.insert(empresas).values({ id: empresaAId, nombre: "Empresa A (prueba 2.7)", nit: `TEST-PED-A-${empresaAId.slice(0, 8)}` })
    );
    await dbComoEmpresa(empresaBId, (tx) =>
      tx.insert(empresas).values({ id: empresaBId, nombre: "Empresa B (prueba 2.7)", nit: `TEST-PED-B-${empresaBId.slice(0, 8)}` })
    );
    const [cuenta] = await dbComoEmpresa(empresaAId, (tx) =>
      tx
        .insert(cuentasMl)
        .values({
          empresaId: empresaAId,
          cuentaIdExterna: `ml-user-ped-${randomUUID()}`,
          nickname: "VENDEDOR_PED",
          accessTokenCifrado: cifrarToken("access"),
          refreshTokenCifrado: cifrarToken("refresh"),
          tokenExpiraTs: new Date(Date.now() + 3600_000),
        })
        .returning({ id: cuentasMl.id })
    );
    const [pedido] = await dbComoEmpresa(empresaAId, (tx) =>
      tx
        .insert(pedidos)
        .values({
          empresaId: empresaAId,
          cuentaMlId: cuenta.id,
          pedidoIdExterno: `ORDEN-${randomUUID()}`,
          fecha: new Date("2026-09-01T10:00:00.000Z"),
          total: "50000",
          moneda: "COP",
          estado: "paid",
        })
        .returning({ id: pedidos.id })
    );
    pedidoId = pedido.id;
  });

  it("registra un evento y aparece en la línea de tiempo con fecha y quién", async () => {
    await registrarEventoPedido(empresaAId, pedidoId, "venta", new Date("2026-09-01T10:00:00.000Z"));

    const resultado = await obtenerPedidoConEventos(empresaAId, pedidoId);
    expect(resultado?.eventos).toHaveLength(1);
    expect(resultado?.eventos[0]).toMatchObject({ paso: "venta", actorTipo: "sistema" });
  });

  it("registrar el mismo paso dos veces no lo duplica", async () => {
    await registrarEventoPedido(empresaAId, pedidoId, "pago", new Date("2026-09-01T11:00:00.000Z"));
    await registrarEventoPedido(empresaAId, pedidoId, "pago", new Date("2026-09-01T12:00:00.000Z")); // reintento, misma clave

    const resultado = await obtenerPedidoConEventos(empresaAId, pedidoId);
    expect(resultado?.eventos.filter((e) => e.paso === "pago")).toHaveLength(1);
  });

  it("los 8 pasos del plan maestro están en el orden fijo correcto", () => {
    expect(PASOS_PEDIDO).toEqual(["venta", "pago", "factura", "empaque", "despacho", "entrega", "novedades", "dinero_conciliado"]);
  });

  it("empresa B nunca ve los pedidos ni los eventos de empresa A", async () => {
    const lista = await listarPedidosFiltrados(empresaBId);
    expect(lista.pedidos).toHaveLength(0);
    expect(lista.total).toBe(0);

    const resultado = await obtenerPedidoConEventos(empresaBId, pedidoId);
    expect(resultado).toBeNull(); // RLS: el pedido de A ni existe bajo el contexto de B
  });
});

// Issue "tabla completa de pedidos" — prueba real contra Postgres de
// búsqueda, filtro por estado/fecha, orden y paginación, todo en
// listarPedidosFiltrados(). 30 pedidos con fecha y total relacionados
// EN SENTIDO INVERSO (fecha sube con i, total baja con i) a propósito:
// así "orden=fecha_desc" y "orden=total_desc" dan resultados distintos
// y la prueba demuestra de verdad qué columna ordena, no una
// coincidencia.
describe("listarPedidosFiltrados — búsqueda, filtro, orden y paginación", () => {
  vi.setConfig({ testTimeout: 20_000 });

  const empresaId = randomUUID();
  const empresaBId = randomUUID();
  const TOTAL_PEDIDOS = 30;

  beforeAll(async () => {
    await dbComoEmpresa(empresaId, (tx) =>
      tx.insert(empresas).values({ id: empresaId, nombre: "Empresa filtros pedidos", nit: `TEST-PEDF-${empresaId.slice(0, 8)}` })
    );
    await dbComoEmpresa(empresaBId, (tx) =>
      tx.insert(empresas).values({ id: empresaBId, nombre: "Empresa B filtros pedidos", nit: `TEST-PEDFB-${empresaBId.slice(0, 8)}` })
    );

    const [cuenta] = await dbComoEmpresa(empresaId, (tx) =>
      tx
        .insert(cuentasMl)
        .values({
          empresaId,
          cuentaIdExterna: `ml-user-pedf-${randomUUID()}`,
          nickname: "VENDEDOR_PEDF",
          accessTokenCifrado: cifrarToken("access"),
          refreshTokenCifrado: cifrarToken("refresh"),
          tokenExpiraTs: new Date(Date.now() + 3600_000),
        })
        .returning({ id: cuentasMl.id })
    );
    const [cuentaB] = await dbComoEmpresa(empresaBId, (tx) =>
      tx
        .insert(cuentasMl)
        .values({
          empresaId: empresaBId,
          cuentaIdExterna: `ml-user-pedfb-${randomUUID()}`,
          nickname: "VENDEDOR_PEDFB",
          accessTokenCifrado: cifrarToken("access-b"),
          refreshTokenCifrado: cifrarToken("refresh-b"),
          tokenExpiraTs: new Date(Date.now() + 3600_000),
        })
        .returning({ id: cuentasMl.id })
    );

    // i=0..29: fecha = 1..30 de enero de 2026 (sube con i); total =
    // 1030..1001 (baja con i). i=15 tiene un pedidoIdExterno único para
    // la prueba de búsqueda; i=20 tiene un estado único ("cancelled")
    // para la prueba de filtro de estado — el resto queda en "paid".
    const filasPedidos = Array.from({ length: TOTAL_PEDIDOS }, (_, i) => ({
      empresaId,
      cuentaMlId: cuenta.id,
      pedidoIdExterno: i === 15 ? "BUSCAME-ESPECIAL" : `FILTRO-${i}`,
      fecha: new Date(Date.UTC(2026, 0, i + 1, 12, 0, 0)),
      total: String(1030 - i),
      moneda: "COP",
      estado: i === 20 ? "cancelled" : "paid",
    }));
    await dbComoEmpresa(empresaId, (tx) => tx.insert(pedidos).values(filasPedidos));

    // Empresa B: un pedido con el MISMO texto de búsqueda que el de A
    // ("BUSCAME-ESPECIAL") — la prueba de aislamiento de abajo confirma
    // que buscar ese texto bajo el contexto de A nunca trae el de B, ni
    // al revés, aunque el texto coincida.
    await dbComoEmpresa(empresaBId, (tx) =>
      tx.insert(pedidos).values({
        empresaId: empresaBId,
        cuentaMlId: cuentaB.id,
        pedidoIdExterno: "BUSCAME-ESPECIAL",
        fecha: new Date("2026-02-01T12:00:00.000Z"),
        total: "999999",
        moneda: "COP",
        estado: "paid",
      })
    );
  });

  it("sin filtros: trae la primera página (25) ordenada por fecha descendente por defecto", async () => {
    const resultado = await listarPedidosFiltrados(empresaId);
    expect(resultado.total).toBe(TOTAL_PEDIDOS);
    expect(resultado.totalPaginas).toBe(2);
    expect(resultado.pagina).toBe(1);
    expect(resultado.pedidos).toHaveLength(25);
    expect(resultado.pedidos[0].pedidoIdExterno).toBe("FILTRO-29"); // el más reciente
  });

  it("página 2 trae el resto (5) — \"Mostrando 26–30 de 30\"", async () => {
    const resultado = await listarPedidosFiltrados(empresaId, { pagina: 2 });
    expect(resultado.pedidos).toHaveLength(5);
    expect(resultado.pagina).toBe(2);
  });

  it("pagina inválida (0, negativa o no entera) se trata como 1, nunca revienta", async () => {
    for (const paginaInvalida of [0, -5, 1.5]) {
      const resultado = await listarPedidosFiltrados(empresaId, { pagina: paginaInvalida });
      expect(resultado.pagina).toBe(1);
    }
  });

  it("pagina 1e20 no es un entero seguro: vuelve a la página 1, sin error", async () => {
    const resultado = await listarPedidosFiltrados(empresaId, { pagina: 1e20 });
    expect(resultado.pagina).toBe(1);
    expect(resultado.pedidos).toHaveLength(25);
    expect(resultado.total).toBe(TOTAL_PEDIDOS);
  });

  it("pagina 99 con 30 pedidos se acota a la última (2) y trae los 5 que faltan", async () => {
    const resultado = await listarPedidosFiltrados(empresaId, { pagina: 99 });
    expect(resultado.pagina).toBe(2);
    expect(resultado.pedidos).toHaveLength(5);
    expect(resultado.total).toBe(TOTAL_PEDIDOS);
  });

  it("búsqueda por número de pedido usa ilike (parcial, sin importar mayúsculas)", async () => {
    const resultado = await listarPedidosFiltrados(empresaId, { busqueda: "buscame" });
    expect(resultado.total).toBe(1);
    expect(resultado.pedidos[0].pedidoIdExterno).toBe("BUSCAME-ESPECIAL");
  });

  it("un % suelto no es un comodín: no matchea ningún pedido", async () => {
    const resultado = await listarPedidosFiltrados(empresaId, { busqueda: "%" });
    expect(resultado.total).toBe(0);
    expect(resultado.pedidos).toHaveLength(0);
  });

  it("una búsqueda de 5000 caracteres se recorta y no revienta", async () => {
    const resultado = await listarPedidosFiltrados(empresaId, { busqueda: "a".repeat(5000) });
    expect(resultado.total).toBe(0);
  });

  it("filtro por estado de la lista permitida", async () => {
    const resultado = await listarPedidosFiltrados(empresaId, { estado: "cancelled" });
    expect(resultado.total).toBe(1);
    expect(resultado.pedidos[0].estado).toBe("cancelled");
  });

  it("un ?estado= fuera de la lista permitida se ignora (nunca un error, nunca 0 resultados por un valor raro)", async () => {
    const resultado = await listarPedidosFiltrados(empresaId, { estado: "estado-que-no-existe" });
    expect(resultado.total).toBe(TOTAL_PEDIDOS);
  });

  it("un ?orden= fuera de la lista permitida se ignora y usa fecha_desc por defecto", async () => {
    const resultado = await listarPedidosFiltrados(empresaId, { orden: "orden-que-no-existe" });
    expect(resultado.pedidos[0].pedidoIdExterno).toBe("FILTRO-29");
  });

  it("orden=total_desc ordena por total, no por fecha (son inversos en esta prueba)", async () => {
    const resultado = await listarPedidosFiltrados(empresaId, { orden: "total_desc" });
    expect(resultado.pedidos[0].pedidoIdExterno).toBe("FILTRO-0"); // total más alto (1030), fecha más vieja
  });

  it("orden=fecha_asc trae primero el pedido más viejo", async () => {
    const resultado = await listarPedidosFiltrados(empresaId, { orden: "fecha_asc" });
    expect(resultado.pedidos[0].pedidoIdExterno).toBe("FILTRO-0");
  });

  it("rango de fechas (desde/hasta, hora de Colombia) solo trae los pedidos de esos días", async () => {
    const resultado = await listarPedidosFiltrados(empresaId, { desde: "2026-01-10", hasta: "2026-01-12" });
    expect(resultado.total).toBe(3); // días 10, 11 y 12 de enero (i=9,10,11)
  });

  it("una fecha imposible o incompleta se ignora (2026-02-30, 2026, 2026-1-5)", async () => {
    for (const fecha of ["2026-02-30", "2026", "2026-1-5"]) {
      const resultado = await listarPedidosFiltrados(empresaId, { desde: fecha, hasta: fecha });
      expect(resultado.total).toBe(TOTAL_PEDIDOS);
    }
  });

  it("aislamiento A/B: buscar el mismo texto nunca mezcla los pedidos de la otra empresa", async () => {
    const [deA, deB] = await Promise.all([
      listarPedidosFiltrados(empresaId, { busqueda: "BUSCAME" }),
      listarPedidosFiltrados(empresaBId, { busqueda: "BUSCAME" }),
    ]);
    expect(deA.total).toBe(1);
    expect(deA.pedidos[0].empresaId).toBe(empresaId);
    expect(deB.total).toBe(1);
    expect(deB.pedidos[0].empresaId).toBe(empresaBId);
  });

  it("RLS: un select de pedidos sin filtrar por empresaId, dentro de A, no devuelve filas de B", async () => {
    const filas = await dbComoEmpresa(empresaId, (tx) => tx.select().from(pedidos));
    expect(filas.length).toBeGreaterThan(0);
    expect(filas.every((fila) => fila.empresaId === empresaId)).toBe(true);
    expect(filas.some((fila) => fila.pedidoIdExterno === "BUSCAME-ESPECIAL")).toBe(true);
  });
});

// Bordes de desde/hasta y desempate por id. Empresa aparte para no
// mover el total de 30 del describe de arriba: esos pedidos están a
// las 12:00 UTC, lejos de las 05:00, y no cubren el corte del día.
describe("listarPedidosFiltrados — bordes de día en Bogotá y desempate por id", () => {
  vi.setConfig({ testTimeout: 20_000 });

  const empresaId = randomUUID();
  // UUID en texto canónico (minúsculas, hex): el orden lexicográfico
  // coincide con la comparación por bytes de Postgres, que es la que
  // usa el ORDER BY de pedidos.id. Ids nuevos en cada corrida para no
  // chocar con la llave primaria si la base de prueba se reutiliza.
  const [idBajo, idAlto] = [randomUUID(), randomUUID()].sort();
  const fechaEmpate = new Date("2026-08-01T12:00:00.000Z");

  beforeAll(async () => {
    await dbComoEmpresa(empresaId, (tx) =>
      tx.insert(empresas).values({ id: empresaId, nombre: "Empresa bordes pedidos", nit: `TEST-PEDB-${empresaId.slice(0, 8)}` })
    );
    const [cuenta] = await dbComoEmpresa(empresaId, (tx) =>
      tx
        .insert(cuentasMl)
        .values({
          empresaId,
          cuentaIdExterna: `ml-user-pedb-${randomUUID()}`,
          nickname: "VENDEDOR_PEDB",
          accessTokenCifrado: cifrarToken("access"),
          refreshTokenCifrado: cifrarToken("refresh"),
          tokenExpiraTs: new Date(Date.now() + 3600_000),
        })
        .returning({ id: cuentasMl.id })
    );

    await dbComoEmpresa(empresaId, (tx) =>
      tx.insert(pedidos).values([
        // 2026-06-01 04:59:59 UTC = 2026-05-31 23:59:59 en Bogotá.
        // Queda afuera de desde=2026-06-01.
        {
          empresaId,
          cuentaMlId: cuenta.id,
          pedidoIdExterno: "DESDE-ANTES",
          fecha: new Date("2026-06-01T04:59:59.000Z"),
          total: "10.00",
          moneda: "COP",
          estado: "paid",
        },
        // 2026-06-01 05:00:00 UTC = 2026-06-01 00:00:00 en Bogotá.
        // Entra en desde=2026-06-01.
        {
          empresaId,
          cuentaMlId: cuenta.id,
          pedidoIdExterno: "DESDE-INICIO",
          fecha: new Date("2026-06-01T05:00:00.000Z"),
          total: "20.00",
          moneda: "COP",
          estado: "paid",
        },
        // 2026-06-02 04:59:59 UTC = 2026-06-01 23:59:59 en Bogotá.
        // Entra en hasta=2026-06-01 (el fin es exclusivo a las 05:00).
        {
          empresaId,
          cuentaMlId: cuenta.id,
          pedidoIdExterno: "HASTA-INCLUIDO",
          fecha: new Date("2026-06-02T04:59:59.000Z"),
          total: "30.00",
          moneda: "COP",
          estado: "paid",
        },
        // 2026-06-02 05:00:00 UTC = 2026-06-02 00:00:00 en Bogotá.
        // Queda afuera de hasta=2026-06-01.
        {
          empresaId,
          cuentaMlId: cuenta.id,
          pedidoIdExterno: "HASTA-EXCLUIDO",
          fecha: new Date("2026-06-02T05:00:00.000Z"),
          total: "40.00",
          moneda: "COP",
          estado: "paid",
        },
        // Misma fecha y el mismo total: el orden lo define el id, en
        // la misma dirección que la columna principal.
        {
          id: idBajo,
          empresaId,
          cuentaMlId: cuenta.id,
          pedidoIdExterno: "EMPATE-BAJO",
          fecha: fechaEmpate,
          total: "777.00",
          moneda: "COP",
          estado: "paid",
        },
        {
          id: idAlto,
          empresaId,
          cuentaMlId: cuenta.id,
          pedidoIdExterno: "EMPATE-ALTO",
          fecha: fechaEmpate,
          total: "777.00",
          moneda: "COP",
          estado: "paid",
        },
      ])
    );
  });

  it("hasta incluye las 04:59:59 UTC del día siguiente y excluye las 05:00 UTC", async () => {
    const resultado = await listarPedidosFiltrados(empresaId, { hasta: "2026-06-01" });
    const ids = resultado.pedidos.map((p) => p.pedidoIdExterno);
    expect(ids).toContain("HASTA-INCLUIDO");
    expect(ids).not.toContain("HASTA-EXCLUIDO");
  });

  it("desde excluye las 04:59:59 UTC de ese día e incluye las 05:00 UTC", async () => {
    const resultado = await listarPedidosFiltrados(empresaId, { desde: "2026-06-01" });
    const ids = resultado.pedidos.map((p) => p.pedidoIdExterno);
    expect(ids).not.toContain("DESDE-ANTES");
    expect(ids).toContain("DESDE-INICIO");
  });

  it("el id desempata en la misma dirección que la columna de orden", async () => {
    for (const orden of ["fecha_desc", "total_desc"] as const) {
      const ids = (await listarPedidosFiltrados(empresaId, { orden })).pedidos.map((p) => p.id);
      expect(ids.indexOf(idAlto)).toBeLessThan(ids.indexOf(idBajo));
    }
    for (const orden of ["fecha_asc", "total_asc"] as const) {
      const ids = (await listarPedidosFiltrados(empresaId, { orden })).pedidos.map((p) => p.id);
      expect(ids.indexOf(idBajo)).toBeLessThan(ids.indexOf(idAlto));
    }
  });
});

// #166 — apodo de la cuenta, filtro por cuenta y estado del envío en la
// lista. Empresas propias para no mover los números de los describe de
// arriba (30 pedidos, páginas de 25 y 5).
describe("listarPedidosFiltrados — cuenta de ML y estado del envío (#166)", () => {
  vi.setConfig({ testTimeout: 20_000 });

  const empresaAId = randomUUID();
  const empresaBId = randomUUID();
  const sufijo = randomUUID().slice(0, 8);
  const externo = (nombre: string) => `${nombre}-166-${sufijo}`;
  let cuentaUnoId: string;
  let cuentaDosId: string;

  async function crearCuenta(empresaId: string, nickname: string): Promise<string> {
    const [cuenta] = await dbComoEmpresa(empresaId, (tx) =>
      tx
        .insert(cuentasMl)
        .values({
          empresaId,
          cuentaIdExterna: `ml-user-166-${randomUUID()}`,
          nickname,
          accessTokenCifrado: cifrarToken("access"),
          refreshTokenCifrado: cifrarToken("refresh"),
          tokenExpiraTs: new Date(Date.now() + 3600_000),
        })
        .returning({ id: cuentasMl.id })
    );
    return cuenta.id;
  }

  async function crearPedido(empresaId: string, cuentaMlId: string, nombre: string, estado: string, dia: number): Promise<string> {
    const [pedido] = await dbComoEmpresa(empresaId, (tx) =>
      tx
        .insert(pedidos)
        .values({
          empresaId,
          cuentaMlId,
          pedidoIdExterno: externo(nombre),
          fecha: new Date(Date.UTC(2026, 9, dia, 15)),
          total: "10000",
          moneda: "COP",
          estado,
        })
        .returning({ id: pedidos.id })
    );
    return pedido.id;
  }

  async function crearDespacho(empresaId: string, cuentaMlId: string, pedidoId: string, status: string, actualizadoTs: Date) {
    await dbComoEmpresa(empresaId, (tx) =>
      tx.insert(despachosMl).values({
        empresaId,
        pedidoId,
        cuentaMlId,
        shipmentIdExterno: `SHIP-166-${randomUUID()}`,
        status,
        actualizadoTs,
      })
    );
  }

  beforeAll(async () => {
    await dbComoEmpresa(empresaAId, (tx) =>
      tx.insert(empresas).values({ id: empresaAId, nombre: "Empresa A (#166)", nit: `TEST-P166A-${empresaAId.slice(0, 8)}` })
    );
    await dbComoEmpresa(empresaBId, (tx) =>
      tx.insert(empresas).values({ id: empresaBId, nombre: "Empresa B (#166)", nit: `TEST-P166B-${empresaBId.slice(0, 8)}` })
    );
    cuentaUnoId = await crearCuenta(empresaAId, "CUENTA_UNO_166");
    cuentaDosId = await crearCuenta(empresaAId, "CUENTA_DOS_166");
    const cuentaBId = await crearCuenta(empresaBId, "CUENTA_B_166");

    // Cuenta uno: un pedido con DOS despachos (el más reciente es
    // "delivered"), uno sin despacho y uno cancelado ya enviado.
    const p1 = await crearPedido(empresaAId, cuentaUnoId, "P1", "paid", 1);
    await crearDespacho(empresaAId, cuentaUnoId, p1, "ready_to_ship", new Date("2026-10-01T16:00:00Z"));
    await crearDespacho(empresaAId, cuentaUnoId, p1, "delivered", new Date("2026-10-03T16:00:00Z"));
    await crearPedido(empresaAId, cuentaUnoId, "P2", "paid", 2);
    const p3 = await crearPedido(empresaAId, cuentaUnoId, "P3", "cancelled", 3);
    await crearDespacho(empresaAId, cuentaUnoId, p3, "shipped", new Date("2026-10-04T16:00:00Z"));
    // Cuenta dos: uno enviado y uno sin despacho.
    const p4 = await crearPedido(empresaAId, cuentaDosId, "P4", "paid", 4);
    await crearDespacho(empresaAId, cuentaDosId, p4, "shipped", new Date("2026-10-05T16:00:00Z"));
    await crearPedido(empresaAId, cuentaDosId, "P5", "paid", 5);

    // Empresa B: un pedido con despacho, mismo día que los de A.
    const pb = await crearPedido(empresaBId, cuentaBId, "PB", "paid", 1);
    await crearDespacho(empresaBId, cuentaBId, pb, "delivered", new Date("2026-10-02T16:00:00Z"));
  });

  const porExterno = (resultado: Awaited<ReturnType<typeof listarPedidosFiltrados>>) =>
    Object.fromEntries(resultado.pedidos.map((p) => [p.pedidoIdExterno, { apodo: p.apodoCuenta, envio: p.estadoEnvio }]));

  it("sin cuentaId trae los pedidos de las dos cuentas, cada uno con su apodo", async () => {
    const resultado = await listarPedidosFiltrados(empresaAId);
    expect(resultado.total).toBe(5);
    expect(resultado.pedidos).toHaveLength(5);
    expect(porExterno(resultado)).toEqual({
      [externo("P1")]: { apodo: "CUENTA_UNO_166", envio: "delivered" },
      [externo("P2")]: { apodo: "CUENTA_UNO_166", envio: null },
      [externo("P3")]: { apodo: "CUENTA_UNO_166", envio: "shipped" },
      [externo("P4")]: { apodo: "CUENTA_DOS_166", envio: "shipped" },
      [externo("P5")]: { apodo: "CUENTA_DOS_166", envio: null },
    });
  });

  it("con cuentaId trae solo los de esa cuenta, y el conteo coincide", async () => {
    const uno = await listarPedidosFiltrados(empresaAId, { cuentaId: cuentaUnoId });
    expect(uno.total).toBe(3);
    expect(uno.pedidos.map((p) => p.pedidoIdExterno).sort()).toEqual([externo("P1"), externo("P2"), externo("P3")]);
    expect(uno.pedidos.every((p) => p.cuentaMlId === cuentaUnoId && p.apodoCuenta === "CUENTA_UNO_166")).toBe(true);

    const dos = await listarPedidosFiltrados(empresaAId, { cuentaId: cuentaDosId, estado: "paid" });
    expect(dos.total).toBe(2);
    expect(dos.pedidos.map((p) => p.pedidoIdExterno).sort()).toEqual([externo("P4"), externo("P5")]);

    const todas = await listarPedidosFiltrados(empresaAId, { cuentaId: null });
    expect(todas.total).toBe(5);
  });

  it("estadoEnvio sale del despacho más reciente y es null sin despacho", async () => {
    const mapa = porExterno(await listarPedidosFiltrados(empresaAId, { cuentaId: cuentaUnoId }));
    expect(mapa[externo("P1")].envio).toBe("delivered");
    expect(mapa[externo("P2")].envio).toBeNull();
  });

  it("un pedido con 2 despachos no sale duplicado y el conteo no cambia", async () => {
    const resultado = await listarPedidosFiltrados(empresaAId, { busqueda: externo("P1") });
    expect(resultado.total).toBe(1);
    expect(resultado.pedidos).toHaveLength(1);
    const ids = (await listarPedidosFiltrados(empresaAId)).pedidos.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("aislamiento A/B: B con el cuentaId de A recibe 0 filas, y A no ve pedidos ni apodos de B", async () => {
    const deBConCuentaDeA = await listarPedidosFiltrados(empresaBId, { cuentaId: cuentaUnoId });
    expect(deBConCuentaDeA.total).toBe(0);
    expect(deBConCuentaDeA.pedidos).toHaveLength(0);

    const deA = await listarPedidosFiltrados(empresaAId);
    expect(deA.pedidos.some((p) => p.pedidoIdExterno === externo("PB"))).toBe(false);
    expect(deA.pedidos.some((p) => p.apodoCuenta === "CUENTA_B_166")).toBe(false);

    const deB = await listarPedidosFiltrados(empresaBId);
    expect(porExterno(deB)).toEqual({ [externo("PB")]: { apodo: "CUENTA_B_166", envio: "delivered" } });
  });
});
