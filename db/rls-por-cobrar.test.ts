import { randomUUID } from "crypto";
import { eq } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { dbComoEmpresa } from "./empresa-context";
import { cuentasFalabella, cuentasMl, movimientosMarketplace, pedidosFinanzas } from "./schema";
import { crearCuentaMlDePrueba, crearVentaDePrueba } from "./test-utils/venta";
import { SinPermisoError } from "../lib/permisos";
import { crearEmpresaConPermisos } from "../lib/test-utils/empresa-con-permiso";
import { leerPartidasPorCobrar } from "../lib/finanzas/por-cobrar-consulta";
import { sincronizarLiberacion, type LectorMl } from "../lib/ml/liberacion";

// Issue #422 — cuentas por cobrar contra Postgres real (RLS no se
// simula): una empresa nunca ve lo que le deben a otra, y la consulta
// solo trae lo que sigue sin pagar.

const AHORA = new Date("2026-11-19T15:00:00Z");
const FUTURO = new Date("2026-11-24T14:00:00Z");

async function crearCuentaFalabella(empresaId: string): Promise<string> {
  const [fila] = await dbComoEmpresa(empresaId, (tx) =>
    tx
      .insert(cuentasFalabella)
      .values({
        empresaId,
        userId: `por-cobrar-${randomUUID()}@ejemplo.com`,
        apiKeyCifrada: { version: 1, iv: "x", authTag: "y", datos: "z" },
        sellerId: `SELLER-${randomUUID()}`,
        nickname: "FALA_PRUEBA",
      })
      .returning({ id: cuentasFalabella.id })
  );
  return fila.id;
}

async function movimiento(empresaId: string, cuentaId: string, estadoPago: string, monto: string, estadoCuenta: string) {
  await dbComoEmpresa(empresaId, (tx) =>
    tx.insert(movimientosMarketplace).values({
      empresaId,
      marketplace: "falabella",
      cuentaFalabellaId: cuentaId,
      numeroOrden: "F-1",
      tipoTransaccion: "Precio",
      categoria: "precio",
      moneda: "COP",
      monto,
      estadoPago,
      estadoCuenta,
      huella: randomUUID(),
    })
  );
}

describe("cuentas por cobrar (RLS)", () => {
  const PERMISOS = [{ modulo: "finanzas" as const, accion: "consultar" as const }];
  let a: { empresaId: string; usuarioId: string };
  let b: { empresaId: string; usuarioId: string };

  beforeAll(async () => {
    a = await crearEmpresaConPermisos("Por cobrar A", PERMISOS);
    b = await crearEmpresaConPermisos("Por cobrar B", PERMISOS);

    // A: una cuenta de México (la moneda sale del sitio, no de un default).
    const cuentaA = await crearCuentaMlDePrueba(a.empresaId);
    await dbComoEmpresa(a.empresaId, (tx) => tx.update(cuentasMl).set({ siteId: "MLM" }).where(eq(cuentasMl.id, cuentaA)));
    const pendiente = { estadoLiberacion: "pending", fechaLiberacion: FUTURO, montoPorLiberar: "850.50" };
    await crearVentaDePrueba(a.empresaId, { cuentaMlId: cuentaA, cabecera: pendiente });
    // No cuentan: ya liberada, fecha ya pasada y cancelada.
    await crearVentaDePrueba(a.empresaId, { cuentaMlId: cuentaA, cabecera: { ...pendiente, estadoLiberacion: "released" } });
    await crearVentaDePrueba(a.empresaId, { cuentaMlId: cuentaA, cabecera: { ...pendiente, fechaLiberacion: new Date("2026-11-18T14:00:00Z") } });
    await crearVentaDePrueba(a.empresaId, { cuentaMlId: cuentaA, cabecera: { ...pendiente, cancelada: true } });

    const falabellaA = await crearCuentaFalabella(a.empresaId);
    await movimiento(a.empresaId, falabellaA, "Pago programado", "100000.0000", "EC-A");
    await movimiento(a.empresaId, falabellaA, "Pago programado", "-15000.5000", "EC-A");
    await movimiento(a.empresaId, falabellaA, "Pagado", "999999.0000", "EC-VIEJO");

    // B: lo mismo, con montos distintos.
    await crearVentaDePrueba(b.empresaId, { cabecera: { ...pendiente, montoPorLiberar: "7777.00" } });
    const falabellaB = await crearCuentaFalabella(b.empresaId);
    await movimiento(b.empresaId, falabellaB, "Abierto", "5555.0000", "EC-B");
  });

  it("cada empresa ve solo lo suyo, con la moneda de cada cuenta", async () => {
    const deA = await leerPartidasPorCobrar(a.empresaId, a.usuarioId, AHORA);
    expect(deA.map((p) => [p.marketplace, p.moneda, p.monto, p.fechaEsperada]).sort()).toEqual([
      ["falabella", "COP", "84999.5000", null],
      ["ml", "MXN", "850.50", "2026-11-24"],
    ]);
    expect(deA.find((p) => p.marketplace === "falabella")).toMatchObject({ referencia: "EC-A", estado: "Pago programado" });

    const deB = await leerPartidasPorCobrar(b.empresaId, b.usuarioId, AHORA);
    expect(deB.map((p) => p.monto).sort()).toEqual(["5555.0000", "7777.00"]);
  });

  it("un usuario de A no puede leer las de B", async () => {
    await expect(leerPartidasPorCobrar(b.empresaId, a.usuarioId, AHORA)).rejects.toBeInstanceOf(SinPermisoError);
  });

  it("la sync guarda la liberación y no vuelve a consultar una venta liberada", async () => {
    const { pedidoId } = await crearVentaDePrueba(a.empresaId);
    const orden = { id: 2000001, status: "paid", payments: [{ id: 91234567890, status: "approved" }] };
    const rutas: string[] = [];
    const leer = (async (ruta: string) => {
      rutas.push(ruta);
      return { ok: true, data: { money_release_status: "released", money_release_date: "2026-11-12T10:00:00.000-04:00", transaction_details: { net_received_amount: 66930.5 } } };
    }) as LectorMl;

    await sincronizarLiberacion(a.empresaId, pedidoId, orden, leer);
    const [fila] = await dbComoEmpresa(a.empresaId, (tx) =>
      tx
        .select({ estado: pedidosFinanzas.estadoLiberacion, fecha: pedidosFinanzas.fechaLiberacion, monto: pedidosFinanzas.montoPorLiberar })
        .from(pedidosFinanzas)
        .where(eq(pedidosFinanzas.pedidoId, pedidoId))
    );
    expect(fila).toEqual({ estado: "released", fecha: new Date("2026-11-12T14:00:00.000Z"), monto: "0.00" });

    await sincronizarLiberacion(a.empresaId, pedidoId, orden, leer);
    expect(rutas).toEqual(["/v1/payments/91234567890"]);

    // B no puede escribir la venta de A: RLS la deja invisible y no la toca.
    await sincronizarLiberacion(b.empresaId, pedidoId, { ...orden, payments: [{ id: 1, status: "approved" }] }, leer);
    expect(rutas).toHaveLength(1);
  });
});
