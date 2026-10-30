import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as tablero from "@/lib/finanzas/tablero";
import { crearEmpresaConPermisos } from "@/lib/test-utils/empresa-con-permiso";
import PanelPage from "./page";

// Issue #143 — Inicio con y sin finanzas.consultar, contra Postgres real.
// Solo se simula la sesión (el contexto del panel lee Clerk y cookies);
// los permisos y las lecturas son los reales. Sin el permiso, el bloque
// de Finanzas no se monta, ninguna lectura de finanzas corre y nada de
// utilidad ni publicidad llega al HTML.

vi.setConfig({ testTimeout: 30_000 });

const sesion = vi.hoisted(() => ({ usuarioId: "", empresaId: "" }));

vi.mock("@/lib/panel-contexto", () => ({
  obtenerContextoPanel: async () => ({ usuario: { id: sesion.usuarioId }, activa: { id: sesion.empresaId, nombre: "Empresa de prueba" } }),
}));

vi.mock("@/lib/finanzas/tablero", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/finanzas/tablero")>();
  return {
    ...real,
    leerTableroMes: vi.fn(real.leerTableroMes),
    leerUtilidadMes: vi.fn(real.leerUtilidadMes),
    leerPublicidadMes: vi.fn(real.leerPublicidadMes),
    leerTableroPorCuenta: vi.fn(real.leerTableroPorCuenta),
  };
});

async function pintarInicio(usuarioId: string, empresaId: string): Promise<string> {
  Object.assign(sesion, { usuarioId, empresaId });
  return renderToStaticMarkup(await PanelPage());
}

const lecturas = () => [tablero.leerTableroMes, tablero.leerUtilidadMes, tablero.leerPublicidadMes, tablero.leerTableroPorCuenta].map((f) => vi.mocked(f));

describe("Inicio · bloque de Finanzas (#143)", () => {
  beforeEach(() => lecturas().forEach((f) => f.mockClear()));

  it("con finanzas.consultar: KPIs, participación, comparativo y publicidad («Sin datos» sin métricas)", async () => {
    const e = await crearEmpresaConPermisos("Inicio con finanzas", [
      { modulo: "finanzas", accion: "consultar" },
      { modulo: "ventas", accion: "consultar" },
    ]);
    const html = await pintarInicio(e.usuarioId, e.empresaId);
    for (const texto of [
      "Indicadores de Finanzas del mes",
      "Ventas de hoy",
      "Utilidad del mes (antes de publicidad)",
      "Publicidad invertida",
      "Sin datos",
      "Participación por cuenta (unidades)",
      "Comparativo por cuenta (equipo)",
      "Publicidad · inversión por cuenta",
      'href="/panel/finanzas"',
    ]) {
      expect(html).toContain(texto);
    }
    for (const f of lecturas()) expect(f).toHaveBeenCalledTimes(1);
  });

  it("sin finanzas.consultar: Inicio como hoy, sin el bloque y sin leer finanzas", async () => {
    const e = await crearEmpresaConPermisos("Inicio sin finanzas", [{ modulo: "ventas", accion: "consultar" }]);
    const html = await pintarInicio(e.usuarioId, e.empresaId);
    expect(html).toContain("Ventas de hoy");
    for (const texto of ["Indicadores de Finanzas del mes", "Utilidad", "Publicidad", "Participación por cuenta", "Recaudo"]) {
      expect(html).not.toContain(texto);
    }
    for (const f of lecturas()) expect(f).not.toHaveBeenCalled();
  });
});
