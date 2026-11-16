import { randomUUID } from "crypto";
import { readFileSync } from "fs";
import path from "path";
import { beforeAll, describe, expect, it } from "vitest";
import { dbComoEmpresa } from "@/db/empresa-context";
import { cuentasFalabella, despachosMl, empresas, pedidoItems, pedidos, pedidosFalabella, pedidosFinanzas } from "@/db/schema";
import { crearDosEmpresas } from "@/db/test-utils/aislamiento";
import { crearCuentaMlDePrueba } from "@/db/test-utils/venta";
import { parsearFiltrosPedidos, TAMANO_PAGINA_PEDIDOS, type CuentasEmpresa } from "./filtros";
import { listarPedidosUnificados, mezclarYCortar, productosFalabellaAgrupados } from "./listado";

// Issue #422 — lista unificada de Pedidos. Lo de base corre contra
// Postgres real (RLS no se simula): mezcla de ML y Falabella, paginación
// sin repetir ni saltar, aislamiento entre empresas y comercio solo con
// Falabella.

const ahora = new Date("2026-11-16T02:30:00Z"); // noviembre en Bogotá
const BASE = Date.UTC(2026, 10, 10, 12, 0, 0);
const CAMPOS_PROHIBIDOS = /costo|utilidad|comision|flete|empaque|packing|envioCongelado|pedidosFinanzas/i;

describe("lista unificada — partes puras", () => {
  it("el archivo de la consulta no toca columnas de costo ni de finanzas", () => {
    const fuente = readFileSync(path.join(__dirname, "listado.ts"), "utf8")
      .split("\n")
      .filter((l) => !l.trim().startsWith("//"))
      .join("\n");
    expect(fuente).not.toMatch(/costoCongelado|comisionMl|fleteMl|empaqueCongelado|envioCongelado|pedidosFinanzas|valorVenta/);
  });

  it("mezcla por fecha y corta de a 50 con desempate estable", () => {
    const ml = Array.from({ length: 60 }, (_, i) => ({ id: `m${String(i).padStart(3, "0")}`, marketplace: "ml" as const, fecha: new Date(BASE + i * 2000) }));
    const fa = Array.from({ length: 60 }, (_, i) => ({ id: `f${String(i).padStart(3, "0")}`, marketplace: "falabella" as const, fecha: new Date(BASE + i * 2000) }));
    const p1 = mezclarYCortar<(typeof ml)[number] | (typeof fa)[number]>(ml, fa, 1);
    const p2 = mezclarYCortar<(typeof ml)[number] | (typeof fa)[number]>(ml, fa, 2);
    expect(p1.filas).toHaveLength(50);
    expect(p1.hayMas).toBe(true);
    expect(new Set([...p1.filas, ...p2.filas].map((f) => f.id)).size).toBe(100);
    // Mismo instante: Falabella antes que ML (desempate por marketplace).
    expect(p1.filas[0].marketplace).toBe("falabella");
    expect(p1.filas[1].marketplace).toBe("ml");
  });

  it("Falabella: agrupa líneas iguales como cantidad y no inventa foto", () => {
    expect(
      productosFalabellaAgrupados([
        { Name: "Lámpara", Sku: "L-1" },
        { Name: "Lámpara", Sku: "L-1" },
        { Name: "Bombillo", Sku: "B-1" },
      ])
    ).toEqual([
      { nombre: "Lámpara", sku: "L-1", cantidad: 2, imagenUrl: null },
      { nombre: "Bombillo", sku: "B-1", cantidad: 1, imagenUrl: null },
    ]);
    expect(productosFalabellaAgrupados({ no: "es arreglo" })).toEqual([]);
  });
});

describe("lista unificada — Postgres real (RLS)", () => {
  let empresaAId: string;
  let empresaBId: string;
  let cuentasA: CuentasEmpresa;
  let pedidoMlConItemsId: string;
  const empresaSoloFalabellaId = randomUUID();
  let cuentasSoloFalabella: CuentasEmpresa;
  // En mayúscula: pedido_items_sku_normalizado exige SKU = upper(btrim(SKU)).
  const sufijo = randomUUID().slice(0, 8).toUpperCase();

  async function crearCuentaFalabella(empresaId: string, nickname: string): Promise<string> {
    const [fila] = await dbComoEmpresa(empresaId, (tx) =>
      tx
        .insert(cuentasFalabella)
        .values({ empresaId, userId: `pedidos-${randomUUID()}@ejemplo.com`, apiKeyCifrada: { version: 1, iv: "x", authTag: "y", datos: "z" }, sellerId: "S", nickname })
        .returning({ id: cuentasFalabella.id })
    );
    return fila.id;
  }

  beforeAll(async () => {
    const contexto = await crearDosEmpresas();
    empresaAId = contexto.empresaAId;
    empresaBId = contexto.empresaBId;
    const cuentaMlId = await crearCuentaMlDePrueba(empresaAId);
    const cuentaFalaId = await crearCuentaFalabella(empresaAId, "Fala A");
    cuentasA = { ml: [{ id: cuentaMlId, nickname: "ML A" }], falabella: [{ id: cuentaFalaId, nickname: "Fala A" }] };

    // 30 de ML (minutos pares) y 31 de Falabella (impares): 61 en total.
    const filasMl = await dbComoEmpresa(empresaAId, (tx) =>
      tx
        .insert(pedidos)
        .values(
          Array.from({ length: 30 }, (_, i) => ({
            empresaId: empresaAId,
            cuentaMlId,
            pedidoIdExterno: `ML-${sufijo}-${i}`,
            fecha: new Date(BASE + i * 2 * 60_000),
            total: "10000.00",
            moneda: "COP",
            estado: i === 0 ? "cancelled" : "paid",
          }))
        )
        .returning({ id: pedidos.id, pedidoIdExterno: pedidos.pedidoIdExterno })
    );
    pedidoMlConItemsId = filasMl.find((f) => f.pedidoIdExterno === `ML-${sufijo}-29`)!.id;
    await dbComoEmpresa(empresaAId, async (tx) => {
      // pedido_items cuelga de la cabecera de venta (FK
      // pedido_items_venta_misma_empresa_fk), no directo de pedidos.
      await tx.insert(pedidosFinanzas).values({ empresaId: empresaAId, pedidoId: pedidoMlConItemsId, cuentaMlId, valorVenta: "10000.00" });
      await tx.insert(pedidoItems).values({
        empresaId: empresaAId,
        pedidoId: pedidoMlConItemsId,
        linea: 1,
        itemIdExterno: "MCO-1",
        titulo: "Gorra azul",
        skuCodigo: `GOR-${sufijo}`,
        cantidad: 2,
        precioUnitario: "5000.00",
        valorLinea: "10000.00",
        costoCongelado: "3000.00",
        comisionMl: "1500.00",
        imagenUrl: "https://http2.mlstatic.com/D_foto-I.jpg",
      });
      await tx.insert(despachosMl).values({
        empresaId: empresaAId,
        pedidoId: pedidoMlConItemsId,
        cuentaMlId,
        shipmentIdExterno: `ENV-${sufijo}`,
        logisticType: "self_service",
        status: "shipped",
        imprimible: false,
      });
    });
    await dbComoEmpresa(empresaAId, (tx) =>
      tx.insert(pedidosFalabella).values(
        Array.from({ length: 31 }, (_, i) => ({
          empresaId: empresaAId,
          cuentaFalabellaId: cuentaFalaId,
          pedidoIdExterno: `FA-${sufijo}-${i}`,
          fecha: new Date(BASE + (i * 2 + 1) * 60_000),
          total: "78000.00",
          moneda: "COP",
          estado: i === 30 ? "delivered" : "pending",
          items: [{ Name: "Lámpara LED", Sku: `LAMP-${sufijo}` }],
        }))
      )
    );

    await dbComoEmpresa(empresaSoloFalabellaId, (tx) =>
      tx.insert(empresas).values({ id: empresaSoloFalabellaId, nombre: "Solo Falabella (prueba #422)", nit: `TEST-SOLOFA-${empresaSoloFalabellaId.slice(0, 8)}` })
    );
    const cuentaSolo = await crearCuentaFalabella(empresaSoloFalabellaId, "Solo Fala");
    cuentasSoloFalabella = { ml: [], falabella: [{ id: cuentaSolo, nickname: "Solo Fala" }] };
    await dbComoEmpresa(empresaSoloFalabellaId, (tx) =>
      tx.insert(pedidosFalabella).values({
        empresaId: empresaSoloFalabellaId,
        cuentaFalabellaId: cuentaSolo,
        pedidoIdExterno: `SOLO-${sufijo}`,
        fecha: new Date(BASE),
        total: "5000.00",
        moneda: "COP",
        estado: "shipped",
        items: [],
      })
    );
  });

  it("mezcla ML y Falabella del más nuevo al más viejo, y la página 2 no repite ni salta pedidos", async () => {
    const p1 = await listarPedidosUnificados(empresaAId, parsearFiltrosPedidos({}, cuentasA, ahora));
    const p2 = await listarPedidosUnificados(empresaAId, parsearFiltrosPedidos({ pagina: "2" }, cuentasA, ahora));
    expect(p1.pedidos).toHaveLength(TAMANO_PAGINA_PEDIDOS);
    expect(p1.hayMas).toBe(true);
    expect(p2.pedidos).toHaveLength(11);
    expect(p2.hayMas).toBe(false);

    const todos = [...p1.pedidos, ...p2.pedidos];
    const ids = todos.map((p) => p.pedidoIdExterno);
    expect(new Set(ids).size).toBe(61);
    expect(ids.filter((id) => id.startsWith("ML-"))).toHaveLength(30);
    expect(ids.filter((id) => id.startsWith("FA-"))).toHaveLength(31);
    for (let i = 1; i < todos.length; i++) expect(todos[i - 1].fecha.getTime()).toBeGreaterThan(todos[i].fecha.getTime());
    expect(ids[0]).toBe(`FA-${sufijo}-30`);
    expect(ids[1]).toBe(`FA-${sufijo}-29`);
    expect(ids[2]).toBe(`ML-${sufijo}-29`);
  });

  it("trae producto, SKU, cantidad, foto y estado, y nunca un campo de costo", async () => {
    const { pedidos: lista } = await listarPedidosUnificados(empresaAId, parsearFiltrosPedidos({}, cuentasA, ahora));
    const ml = lista.find((p) => p.id === pedidoMlConItemsId)!;
    expect(ml.productos).toEqual([{ nombre: "Gorra azul", sku: `GOR-${sufijo}`, cantidad: 2, imagenUrl: "https://http2.mlstatic.com/D_foto-I.jpg" }]);
    expect(ml.estado.etiqueta).toBe("Enviado");
    expect(ml.cuenta).toBeTruthy();
    expect(lista[0].estado.etiqueta).toBe("Entregado");
    const json = JSON.stringify(lista);
    expect(json).not.toMatch(CAMPOS_PROHIBIDOS);
    expect(Object.keys(ml).sort()).toEqual(["clave", "cuenta", "estado", "fecha", "id", "marketplace", "moneda", "pedidoIdExterno", "productos", "total"]);
  });

  it("filtra por estado, marketplace, tienda y búsqueda", async () => {
    const enviados = await listarPedidosUnificados(empresaAId, parsearFiltrosPedidos({ estado: "enviado" }, cuentasA, ahora));
    expect(enviados.pedidos.map((p) => p.id)).toEqual([pedidoMlConItemsId]);

    const cancelados = await listarPedidosUnificados(empresaAId, parsearFiltrosPedidos({ estado: "cancelado" }, cuentasA, ahora));
    expect(cancelados.pedidos.map((p) => p.pedidoIdExterno)).toEqual([`ML-${sufijo}-0`]);

    const pendientesMl = await listarPedidosUnificados(empresaAId, parsearFiltrosPedidos({ estado: "pendiente", marketplace: "ml" }, cuentasA, ahora));
    expect(pendientesMl.pedidos).toHaveLength(28); // 30 − cancelado − enviado

    const soloFala = await listarPedidosUnificados(empresaAId, parsearFiltrosPedidos({ tienda: `falabella:${cuentasA.falabella[0].id}` }, cuentasA, ahora));
    expect(soloFala.pedidos.every((p) => p.marketplace === "falabella")).toBe(true);

    const porSku = await listarPedidosUnificados(empresaAId, parsearFiltrosPedidos({ q: `gor-${sufijo}` }, cuentasA, ahora));
    expect(porSku.pedidos.map((p) => p.id)).toEqual([pedidoMlConItemsId]);
    const porProductoFala = await listarPedidosUnificados(empresaAId, parsearFiltrosPedidos({ q: `LAMP-${sufijo}` }, cuentasA, ahora));
    expect(porProductoFala.pedidos).toHaveLength(31);
    const porNumero = await listarPedidosUnificados(empresaAId, parsearFiltrosPedidos({ q: `FA-${sufijo}-7` }, cuentasA, ahora));
    expect(porNumero.pedidos.map((p) => p.pedidoIdExterno)).toEqual([`FA-${sufijo}-7`]);
    const comodin = await listarPedidosUnificados(empresaAId, parsearFiltrosPedidos({ q: "%" }, cuentasA, ahora));
    expect(comodin.pedidos).toHaveLength(0);
  });

  it("la empresa B no ve ningún pedido de A, ni pidiendo la tienda de A", async () => {
    const vacia: CuentasEmpresa = { ml: [], falabella: [] };
    const deB = await listarPedidosUnificados(empresaBId, parsearFiltrosPedidos({}, vacia, ahora));
    expect(deB.pedidos).toHaveLength(0);
    // Aunque el filtro dejara pasar la cuenta de A, RLS no devuelve nada.
    const forzado = await listarPedidosUnificados(empresaBId, parsearFiltrosPedidos({ tienda: `ml:${cuentasA.ml[0].id}` }, cuentasA, ahora));
    expect(forzado.pedidos).toHaveLength(0);
  });

  it("un comercio solo con Falabella ve sus pedidos sin cuenta de Mercado Libre", async () => {
    const r = await listarPedidosUnificados(empresaSoloFalabellaId, parsearFiltrosPedidos({}, cuentasSoloFalabella, ahora));
    expect(r.pedidos.map((p) => p.pedidoIdExterno)).toEqual([`SOLO-${sufijo}`]);
    expect(r.pedidos[0].estado.etiqueta).toBe("Enviado");
  });
});
