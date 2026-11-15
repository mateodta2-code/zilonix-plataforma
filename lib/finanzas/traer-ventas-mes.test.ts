import { eq } from "drizzle-orm";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { dbComoEmpresa } from "@/db/empresa-context";
import { cuentasMl } from "@/db/schema";
import { crearCuentaMlDePrueba } from "@/db/test-utils/venta";
import { SinPermisoError } from "@/lib/permisos";
import { crearEmpresaConPermisos } from "@/lib/test-utils/empresa-con-permiso";
import type { ResultadoSyncVentas } from "@/lib/ml/ventas-finanzas";
import { inicioMesBogota, textoResultadoCuenta, traerVentasDelMes } from "./traer-ventas-mes";

// Issue #131 — «Traer ventas de este mes». sincronizarVentasCuenta ya
// tiene sus pruebas con ML simulado (lib/ml/ventas-finanzas.test.ts);
// acá se inyecta una falsa para probar qué cuentas se piden, con qué
// rango, el permiso y que una cuenta caída no corte las demás.

type Sincronizar = (empresaId: string, cuentaMlId: string, cuentaIdExterna: string, rango: { desde: Date }) => Promise<ResultadoSyncVentas>;

const SYNC_VACIO: ResultadoSyncVentas = { leidas: 0, guardadas: 0, congeladas: 0, fallidas: 0, cortadaPorLimite: false };

describe("inicioMesBogota (issue #131)", () => {
  it("es las 00:00 de Bogotá del día 1, también cuando en UTC ya es otro mes", () => {
    expect(inicioMesBogota(new Date("2026-10-28T15:00:00Z")).toISOString()).toBe("2026-10-01T05:00:00.000Z");
    // 1 de noviembre 02:00 UTC = 31 de octubre 21:00 en Bogotá.
    expect(inicioMesBogota(new Date("2026-11-01T02:00:00Z")).toISOString()).toBe("2026-10-01T05:00:00.000Z");
  });
});

describe("textoResultadoCuenta (issue #131)", () => {
  it("resume guardadas, errores y el corte por límite", () => {
    const base = { cuentaMlId: "c", nickname: "STORE" };
    expect(textoResultadoCuenta({ ...base, ok: true, sync: { ...SYNC_VACIO, leidas: 3, guardadas: 3 } })).toBe("STORE: 3 de 3 ventas guardadas.");
    expect(textoResultadoCuenta({ ...base, ok: true, sync: { ...SYNC_VACIO, leidas: 1, guardadas: 0, fallidas: 1, cortadaPorLimite: true } })).toContain(
      "1 con error. Mercado Libre frenó"
    );
    expect(textoResultadoCuenta({ ...base, ok: false, error: "No se pudo." })).toBe("STORE: No se pudo.");
  });
});

describe("traerVentasDelMes (issue #131)", () => {
  let empresaAId: string;
  let usuarioAId: string;
  let soloConsulta: { empresaId: string; usuarioId: string };
  let cuenta1: string;
  let cuenta2: string;
  let desconectada: string;
  let cuentaB: string;

  beforeAll(async () => {
    const modificar = [
      { modulo: "finanzas" as const, accion: "consultar" as const },
      { modulo: "finanzas" as const, accion: "modificar" as const },
    ];
    ({ empresaId: empresaAId, usuarioId: usuarioAId } = await crearEmpresaConPermisos("Traer ventas A", modificar));
    const { empresaId: empresaBId } = await crearEmpresaConPermisos("Traer ventas B", modificar);
    soloConsulta = await crearEmpresaConPermisos("Traer ventas solo consulta", [{ modulo: "finanzas", accion: "consultar" }]);
    await crearCuentaMlDePrueba(soloConsulta.empresaId);
    cuenta1 = await crearCuentaMlDePrueba(empresaAId);
    cuenta2 = await crearCuentaMlDePrueba(empresaAId);
    desconectada = await crearCuentaMlDePrueba(empresaAId);
    await dbComoEmpresa(empresaAId, (tx) => tx.update(cuentasMl).set({ desconectadaTs: new Date() }).where(eq(cuentasMl.id, desconectada)));
    cuentaB = await crearCuentaMlDePrueba(empresaBId);
  });

  it("pide cada cuenta conectada de la empresa desde el día 1 del mes de Bogotá; una que falla no corta las demás", async () => {
    const sincronizar = vi.fn<Sincronizar>(async (_e, cuentaMlId) => {
      if (cuentaMlId === cuenta2) throw new Error("token vencido");
      return { ...SYNC_VACIO, leidas: 2, guardadas: 2 };
    });
    const resultados = await traerVentasDelMes(empresaAId, usuarioAId, null, new Date("2026-10-28T15:00:00Z"), sincronizar);

    const pedidas = sincronizar.mock.calls.map((c) => c[1]).sort();
    expect(pedidas).toEqual([cuenta1, cuenta2].sort());
    for (const llamada of sincronizar.mock.calls) {
      expect(llamada[0]).toBe(empresaAId);
      expect(llamada[3].desde.toISOString()).toBe("2026-10-01T05:00:00.000Z");
    }
    expect(resultados.find((r) => r.cuentaMlId === cuenta1)?.ok).toBe(true);
    const fallida = resultados.find((r) => r.cuentaMlId === cuenta2);
    expect(fallida?.ok).toBe(false);
    // El mensaje de la pantalla no filtra el error interno.
    expect(fallida && !fallida.ok && fallida.error).not.toContain("token");
  });

  it("con una cuenta elegida solo pide esa, y una cuenta de otra empresa no trae nada", async () => {
    const sincronizar = vi.fn<Sincronizar>(async () => SYNC_VACIO);
    await traerVentasDelMes(empresaAId, usuarioAId, cuenta1, new Date(), sincronizar);
    expect(sincronizar.mock.calls.map((c) => c[1])).toEqual([cuenta1]);

    sincronizar.mockClear();
    expect(await traerVentasDelMes(empresaAId, usuarioAId, cuentaB, new Date(), sincronizar)).toEqual([]);
    expect(sincronizar).not.toHaveBeenCalled();
  });

  it("con solo finanzas.consultar, o sin membresía en la empresa, no llama a Mercado Libre", async () => {
    const sincronizar = vi.fn<Sincronizar>(async () => SYNC_VACIO);
    await expect(traerVentasDelMes(soloConsulta.empresaId, soloConsulta.usuarioId, null, new Date(), sincronizar)).rejects.toBeInstanceOf(SinPermisoError);
    await expect(traerVentasDelMes(empresaAId, soloConsulta.usuarioId, null, new Date(), sincronizar)).rejects.toBeInstanceOf(SinPermisoError);
    expect(sincronizar).not.toHaveBeenCalled();
  });
});
