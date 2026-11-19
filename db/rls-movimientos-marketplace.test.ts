import { randomUUID } from "crypto";
import { and, eq } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { dbComoEmpresa } from "./empresa-context";
import { cuentasFalabella, movimientosMarketplace } from "./schema";
import { SinPermisoError } from "../lib/permisos";
import { crearEmpresaConPermisos } from "../lib/test-utils/empresa-con-permiso";
import { CORTE_PRUEBA, crearReporteDePrueba, ENCABEZADO_REPORTE, filasReporteCorte, SELLER_ID_PRUEBA } from "../lib/test-utils/reporte-falabella";
import {
  importarReporteFalabella,
  leerCorteFalabella,
  listarCortesFalabella,
  ReporteFalabellaInvalidoError,
  SIN_CORTE,
} from "../lib/falabella/conciliacion";

// Issue #422 — movimientos_marketplace contra Postgres real (RLS no se
// simula): aislamiento entre empresas, FK compuesta con la cuenta,
// deduplicación al reimportar y la suma del corte del 11 de noviembre.

const PERMISOS = [
  { modulo: "finanzas" as const, accion: "consultar" as const },
  { modulo: "finanzas" as const, accion: "modificar" as const },
];

// numeric de Postgres llega con ceros a la derecha ("117830.9400").
const limpio = (valor: string) => valor.replace(/(\.\d*?)0+$/, "$1").replace(/\.$/, "");

async function crearCuentaFalabella(empresaId: string, sellerId: string): Promise<string> {
  const [fila] = await dbComoEmpresa(empresaId, (tx) =>
    tx
      .insert(cuentasFalabella)
      .values({
        empresaId,
        userId: `conciliacion-${randomUUID()}@ejemplo.com`,
        apiKeyCifrada: { version: 1, iv: "x", authTag: "y", datos: "z" },
        sellerId,
        nickname: `Tienda ${sellerId}`,
      })
      .returning({ id: cuentasFalabella.id })
  );
  return fila.id;
}

const archivo = (contenido: Buffer) => ({ nombre: "reporte.xlsx", contenido });

describe("movimientos_marketplace (RLS y conciliación Falabella)", () => {
  let a: { empresaId: string; usuarioId: string };
  let b: { empresaId: string; usuarioId: string };
  let cuentaAId: string;
  let cuentaBId: string;

  beforeAll(async () => {
    a = await crearEmpresaConPermisos("Conciliación A", PERMISOS);
    b = await crearEmpresaConPermisos("Conciliación B", PERMISOS);
    cuentaAId = await crearCuentaFalabella(a.empresaId, SELLER_ID_PRUEBA);
    cuentaBId = await crearCuentaFalabella(b.empresaId, "OTRO_SELLER");
  });

  it("importa el corte, suma el «Pago a recibir» y reimportar no duplica", async () => {
    const primera = await importarReporteFalabella(a.empresaId, a.usuarioId, archivo(crearReporteDePrueba()));
    expect(primera).toMatchObject({ nuevas: 28, repetidas: 0, noReconocidas: [], tiposSinCategoria: [] });

    const segunda = await importarReporteFalabella(a.empresaId, a.usuarioId, archivo(crearReporteDePrueba()));
    expect(segunda).toMatchObject({ nuevas: 0, repetidas: 28 });

    const filas = await dbComoEmpresa(a.empresaId, (tx) => tx.select({ id: movimientosMarketplace.id }).from(movimientosMarketplace));
    expect(filas).toHaveLength(28);

    const cortes = await listarCortesFalabella(a.empresaId, a.usuarioId);
    expect(cortes).toHaveLength(1);
    expect(cortes[0]).toMatchObject({ estadoCuenta: CORTE_PRUEBA, moneda: "COP", lineas: 28, ordenes: 8, estadosPago: ["Pagado"] });
    expect(limpio(cortes[0].total)).toBe("117830.94");

    const detalle = await leerCorteFalabella(a.empresaId, a.usuarioId, { cuentaId: cuentaAId, estadoCuenta: CORTE_PRUEBA, moneda: "COP" });
    expect(detalle).not.toBeNull();
    expect(limpio(detalle!.totales.precio)).toBe("185800");
    expect(limpio(detalle!.totales.comision)).toBe("-28869");
    expect(limpio(detalle!.totales.envio)).toBe("-12300");
    expect(limpio(detalle!.totales.retencion)).toBe("-26800.06");
    expect(limpio(detalle!.pagado)).toBe("117830.94");
    // Las retenciones no bajan la utilidad: 185800 - 28869 - 12300.
    expect(limpio(detalle!.netoAntesDeRetenciones)).toBe("144631");
    expect(detalle!.ordenes).toHaveLength(8);
    const primeraOrden = detalle!.ordenes.find((o) => o.numeroOrden === "3000001")!;
    // 20000 de precio, -3108 de comisión, -7900 de envío; retenciones aparte.
    expect(limpio(primeraOrden.vendido)).toBe("20000");
    expect(limpio(primeraOrden.cobradoFalabella)).toBe("-11008");
    expect(limpio(primeraOrden.retenciones)).toBe("-8933.35");
    expect(limpio(primeraOrden.pagado)).toBe("58.65");
  });

  it("el reporte del periodo y luego el del corte son las mismas líneas: solo cambia el estado", async () => {
    const empresa = await crearEmpresaConPermisos("Conciliación periodo", PERMISOS);
    const cuentaId = await crearCuentaFalabella(empresa.empresaId, SELLER_ID_PRUEBA);
    const columnaEstado = ENCABEZADO_REPORTE.indexOf("Estado de pago");
    const columnaCorte = ENCABEZADO_REPORTE.indexOf("Nº estado de cuenta");
    const pendientes = filasReporteCorte().map((f) => f.map((v, i) => (i === columnaEstado ? "Pendiente" : i === columnaCorte ? null : v)));

    await importarReporteFalabella(empresa.empresaId, empresa.usuarioId, archivo(crearReporteDePrueba(pendientes)));
    expect(await leerCorteFalabella(empresa.empresaId, empresa.usuarioId, { cuentaId, estadoCuenta: SIN_CORTE, moneda: "COP" })).not.toBeNull();

    const corte = await importarReporteFalabella(empresa.empresaId, empresa.usuarioId, archivo(crearReporteDePrueba()));
    expect(corte).toMatchObject({ nuevas: 0, repetidas: 28 });
    const cortes = await listarCortesFalabella(empresa.empresaId, empresa.usuarioId);
    expect(cortes.map((c) => [c.estadoCuenta, c.estadosPago])).toEqual([[CORTE_PRUEBA, ["Pagado"]]]);
  });

  it("rechaza un reporte de un Seller ID que no es de la empresa", async () => {
    await expect(importarReporteFalabella(b.empresaId, b.usuarioId, archivo(crearReporteDePrueba()))).rejects.toThrow(ReporteFalabellaInvalidoError);
    const deB = await dbComoEmpresa(b.empresaId, (tx) => tx.select({ id: movimientosMarketplace.id }).from(movimientosMarketplace));
    expect(deB).toHaveLength(0);
  });

  it("un rol con solo finanzas.consultar no puede importar", async () => {
    const lector = await crearEmpresaConPermisos("Conciliación lector", [{ modulo: "finanzas", accion: "consultar" }]);
    await crearCuentaFalabella(lector.empresaId, SELLER_ID_PRUEBA);
    await expect(importarReporteFalabella(lector.empresaId, lector.usuarioId, archivo(crearReporteDePrueba()))).rejects.toThrow(SinPermisoError);
  });

  it("B no ve ni edita los movimientos de A, ni ve sus cortes", async () => {
    const [fila] = await dbComoEmpresa(a.empresaId, (tx) => tx.select({ id: movimientosMarketplace.id }).from(movimientosMarketplace).limit(1));
    const veB = await dbComoEmpresa(b.empresaId, (tx) => tx.select().from(movimientosMarketplace).where(eq(movimientosMarketplace.id, fila.id)));
    expect(veB).toHaveLength(0);

    const editadas = await dbComoEmpresa(b.empresaId, (tx) =>
      tx
        .update(movimientosMarketplace)
        .set({ empresaId: b.empresaId, monto: "0" })
        .where(eq(movimientosMarketplace.id, fila.id))
        .returning({ id: movimientosMarketplace.id })
    );
    expect(editadas).toHaveLength(0);

    expect(await listarCortesFalabella(b.empresaId, b.usuarioId)).toEqual([]);
    expect(await leerCorteFalabella(b.empresaId, b.usuarioId, { cuentaId: cuentaAId, estadoCuenta: CORTE_PRUEBA, moneda: "COP" })).toBeNull();
  });

  it("B no puede insertar con el empresa_id de A ni colgar un movimiento de la cuenta de A", async () => {
    const base = {
      marketplace: "falabella",
      tipoTransaccion: "Comisión",
      categoria: "comision" as const,
      moneda: "COP",
      monto: "-1",
      huella: randomUUID(),
    };
    await expect(
      dbComoEmpresa(b.empresaId, (tx) => tx.insert(movimientosMarketplace).values({ ...base, empresaId: a.empresaId, cuentaFalabellaId: cuentaAId }))
    ).rejects.toThrow();
    // FK compuesta (empresa_id, cuenta_falabella_id): el chequeo de FK no
    // pasa por RLS, así que sin ella B podría usar el uuid de la cuenta de A.
    await expect(
      dbComoEmpresa(b.empresaId, (tx) => tx.insert(movimientosMarketplace).values({ ...base, empresaId: b.empresaId, cuentaFalabellaId: cuentaAId }))
    ).rejects.toThrow();
    const propias = await dbComoEmpresa(b.empresaId, (tx) =>
      tx
        .insert(movimientosMarketplace)
        .values({ ...base, empresaId: b.empresaId, cuentaFalabellaId: cuentaBId })
        .returning({ id: movimientosMarketplace.id })
    );
    expect(propias).toHaveLength(1);
    const deA = await dbComoEmpresa(a.empresaId, (tx) =>
      tx.select().from(movimientosMarketplace).where(and(eq(movimientosMarketplace.id, propias[0].id)))
    );
    expect(deA).toHaveLength(0);
  });
});
