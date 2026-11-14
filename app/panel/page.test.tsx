import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as indicadores from "@/lib/finanzas/indicadores";
import * as metaMes from "@/lib/finanzas/meta-mes";
import * as tablero from "@/lib/finanzas/tablero";
import { guardarMetaMensual } from "@/lib/metas-mensuales";
import { crearEmpresaConPermisos } from "@/lib/test-utils/empresa-con-permiso";
import PanelPage from "./page";

// Issue #143 — Inicio con y sin finanzas.consultar, contra Postgres real.
// Solo se simula la sesión (el contexto del panel lee Clerk y cookies);
// los permisos y las lecturas son los reales. Sin el permiso, el tablero
// de Finanzas no se monta, ninguna lectura de finanzas corre y nada de
// utilidad ni publicidad llega al HTML.
//
// 13-nov (Sharel y el equipo): con Finanzas, Inicio es Hoy · Meta del
// mes · Período (mes en curso o el rango del filtro) · Operación.

vi.setConfig({ testTimeout: 30_000 });

const sesion = vi.hoisted(() => ({
  usuarioId: "",
  empresaId: "",
  rolNombre: "Rol de prueba",
  permisos: [] as { modulo: string; accion: string; alcance: string }[],
}));

vi.mock("@/lib/panel-contexto", () => ({
  obtenerContextoPanel: async () => ({
    usuario: { id: sesion.usuarioId },
    activa: { id: sesion.empresaId, nombre: "Empresa de prueba" },
    rolNombre: sesion.rolNombre,
    permisos: sesion.permisos,
  }),
}));

// ChecklistOnboarding (components/panel/ChecklistOnboarding.tsx) es un
// Server Component async — renderToStaticMarkup no puede resolverlo
// como hijo (solo sabe renderizar JSX ya sincrónico), así que se
// mockea acá. Su propio comportamiento ya está cubierto por
// ChecklistOnboardingCliente.test.tsx y lib/onboarding.test.ts.
vi.mock("@/components/panel/ChecklistOnboarding", () => ({
  ChecklistOnboarding: () => null,
}));

vi.mock("@/lib/finanzas/indicadores", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/finanzas/indicadores")>();
  return { ...real, leerIndicadores: vi.fn(real.leerIndicadores) };
});
vi.mock("@/lib/finanzas/meta-mes", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/finanzas/meta-mes")>();
  return { ...real, leerMetaDelMes: vi.fn(real.leerMetaDelMes) };
});
vi.mock("@/lib/finanzas/tablero", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/finanzas/tablero")>();
  return { ...real, leerTableroMes: vi.fn(real.leerTableroMes) };
});

type PermisoPrueba = { modulo: "ventas" | "inventario" | "finanzas"; accion: "consultar" | "modificar" };

async function pintarInicio(
  e: { usuarioId: string; empresaId: string },
  permisos: PermisoPrueba[],
  searchParams: Record<string, string> = {},
  rolNombre = "Rol de prueba"
): Promise<string> {
  Object.assign(sesion, { usuarioId: e.usuarioId, empresaId: e.empresaId, rolNombre, permisos: permisos.map((p) => ({ ...p, alcance: "todo" })) });
  return renderToStaticMarkup(await PanelPage({ searchParams }));
}

const lecturas = () => ({
  indicadores: vi.mocked(indicadores.leerIndicadores),
  meta: vi.mocked(metaMes.leerMetaDelMes),
  tablero: vi.mocked(tablero.leerTableroMes),
});

const CON_FINANZAS: PermisoPrueba[] = [
  { modulo: "finanzas", accion: "consultar" },
  { modulo: "ventas", accion: "consultar" },
];

describe("Inicio (#143; Hoy · Meta · Período, 13-nov)", () => {
  beforeEach(() => Object.values(lecturas()).forEach((f) => f.mockClear()));

  it("con finanzas.consultar: Hoy, meta sin fijar, mes en curso con variación, gráficas y operación", async () => {
    const e = await crearEmpresaConPermisos("Inicio con finanzas", CON_FINANZAS);
    const html = await pintarInicio(e, CON_FINANZAS);
    for (const texto of [
      "Hoy",
      "Meta del mes",
      "Sin meta para este mes.",
      "Solo el Dueño de la empresa la puede fijar.",
      "Mes en curso",
      "Número de ventas",
      "Recaudo",
      "Ticket promedio",
      "Utilidad (antes de publicidad)",
      "Margen",
      "Publicidad",
      "Utilidad después de publicidad",
      "Ventas por cuenta",
      "vs. mismo tramo mes anterior",
      "Participación por cuenta (ventas)",
      "Comparativo por cuenta (equipo)",
      "Operación",
      "Pedidos",
    ]) {
      expect(html).toContain(texto);
    }
    // Las tarjetas viejas de arriba no se repiten.
    expect(html).not.toContain("Ventas de hoy");
    expect(html).not.toContain("Guardar meta");
    // Hoy + mes (el período ES el mes: no se lee dos veces), más la variación.
    expect(lecturas().indicadores).toHaveBeenCalledTimes(2);
    expect(lecturas().tablero).toHaveBeenCalledTimes(1);
    expect(lecturas().meta).toHaveBeenCalledTimes(1);
  });

  it("con filtro de fechas: «Período elegido», se lee ese rango y no hay variación; un rango inválido avisa y muestra el mes", async () => {
    const e = await crearEmpresaConPermisos("Inicio con filtro", CON_FINANZAS);
    const html = await pintarInicio(e, CON_FINANZAS, { desde: "2026-10-01", hasta: "2026-10-15" });
    expect(html).toContain("Período elegido");
    expect(html).toContain("2026-10-01 a 2026-10-15 · 15 días");
    expect(html).not.toContain("vs. mismo tramo mes anterior");
    expect(lecturas().indicadores).toHaveBeenCalledTimes(3);
    expect(lecturas().tablero).not.toHaveBeenCalled();

    const malo = await pintarInicio(e, CON_FINANZAS, { desde: "2026-09-01", hasta: "2026-10-30" });
    expect(malo).toContain("como máximo 31 días");
    expect(malo).toContain("Se muestra el mes en curso.");
    expect(malo).toContain("Mes en curso");
  });

  it("el Dueño ve el formulario de la meta; con meta guardada se ve el avance detallado", async () => {
    const permisos: PermisoPrueba[] = [...CON_FINANZAS, { modulo: "finanzas", accion: "modificar" }];
    const e = await crearEmpresaConPermisos("Inicio dueño", permisos);
    const sinMeta = await pintarInicio(e, permisos, {}, "Dueño");
    expect(sinMeta).toContain("Guardar meta");
    expect(sinMeta).toContain("Fíjala abajo");

    const mes = metaMes.primerDiaDelMes(new Date());
    await guardarMetaMensual({ empresaId: e.empresaId, usuarioId: e.usuarioId, mes, metaUtilidad: "20000000" });
    const conMeta = await pintarInicio(e, permisos, {}, "Dueño");
    for (const texto of ["Meta", "Llevas", "Avance", "Cambiar la meta del mes", "COP 20.000.000"]) expect(conMeta).toContain(texto);
    // Sin ventas en el mes: llevas $0, avance 0 % y falta toda la meta.
    for (const texto of ["0,0 %", "Falta para la meta", "= Utilidad después de publicidad", "Proyección al cierre"]) expect(conMeta).toContain(texto);
  });

  it("sin finanzas.consultar: Inicio con las tarjetas de siempre, sin leer finanzas", async () => {
    const permisos: PermisoPrueba[] = [{ modulo: "ventas", accion: "consultar" }];
    const e = await crearEmpresaConPermisos("Inicio sin finanzas", permisos);
    const html = await pintarInicio(e, permisos);
    expect(html).toContain("Ventas de hoy");
    for (const texto of ["Meta del mes", "Número de ventas", "Utilidad", "Publicidad", "Participación por cuenta", "Recaudo"]) {
      expect(html).not.toContain(texto);
    }
    for (const f of Object.values(lecturas())) expect(f).not.toHaveBeenCalled();
  });

  it("sin las pestañas Resumen · Pedidos · Despachos · SKU (pedido del equipo, 13-nov)", async () => {
    const permisos: PermisoPrueba[] = [
      { modulo: "ventas", accion: "consultar" },
      { modulo: "inventario", accion: "consultar" },
    ];
    const e = await crearEmpresaConPermisos("Inicio sin pestañas", permisos);
    const html = await pintarInicio(e, permisos);
    expect(html).toContain("Ventas de hoy");
    expect(html).toContain("SKU sin vincular");
    for (const ruta of ["/panel/pedidos", "/panel/despachos", "/panel/sku"]) {
      expect(html).not.toContain(`href="${ruta}"`);
    }
    expect(html).not.toContain(">Resumen<");
  });
});
