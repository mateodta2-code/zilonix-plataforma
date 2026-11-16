import { describe, expect, it } from "vitest";
import { fuentesDeFiltros, hrefPedidos, PAGINA_MAXIMA_PEDIDOS, parsearFiltrosPedidos, type CuentasEmpresa } from "./filtros";

const cuentas: CuentasEmpresa = {
  ml: [{ id: "11111111-1111-1111-1111-111111111111", nickname: "Tienda ML" }],
  falabella: [{ id: "22222222-2222-2222-2222-222222222222", nickname: "Tienda Fala" }],
};
// Domingo 15/11/2026, 21:30 en Bogotá (lunes 02:30 UTC).
const ahora = new Date("2026-11-16T02:30:00Z");

describe("filtros de Pedidos (#422)", () => {
  it("por defecto: Este mes, en zona Bogotá, todos los marketplaces, página 1", () => {
    const f = parsearFiltrosPedidos({}, cuentas, ahora);
    expect(f.periodo).toBe("mes");
    expect(f.rango?.inicio.toISOString()).toBe("2026-11-01T05:00:00.000Z");
    expect(f.rango?.finExclusivo.toISOString()).toBe("2026-12-01T05:00:00.000Z");
    expect(f).toMatchObject({ marketplace: "todos", tienda: null, estado: null, q: null, pagina: 1 });
  });

  it("Hoy, Ayer y Esta semana usan el día de Bogotá, no el del servidor", () => {
    expect(parsearFiltrosPedidos({ periodo: "hoy" }, cuentas, ahora).rango?.inicio.toISOString()).toBe("2026-11-15T05:00:00.000Z");
    expect(parsearFiltrosPedidos({ periodo: "ayer" }, cuentas, ahora).rango?.inicio.toISOString()).toBe("2026-11-14T05:00:00.000Z");
    const semana = parsearFiltrosPedidos({ periodo: "semana" }, cuentas, ahora).rango;
    expect(semana?.inicio.toISOString()).toBe("2026-11-09T05:00:00.000Z"); // lunes
    expect(semana?.finExclusivo.toISOString()).toBe("2026-11-16T05:00:00.000Z");
  });

  it("Personalizado valida fechas reales y avisa el error en vez de adivinar", () => {
    const ok = parsearFiltrosPedidos({ periodo: "personalizado", desde: "2026-10-01", hasta: "2026-10-15" }, cuentas, ahora);
    expect(ok.rango?.inicio.toISOString()).toBe("2026-10-01T05:00:00.000Z");
    const mal = parsearFiltrosPedidos({ periodo: "personalizado", desde: "2026-02-30", hasta: "2026-03-01" }, cuentas, ahora);
    expect(mal.rango).toBeNull();
    expect(mal.error).toBeTruthy();
  });

  it("Desde/Hasta con el select en «Este mes» se toman como rango personalizado (revisión PR #433)", () => {
    const f = parsearFiltrosPedidos({ periodo: "mes", desde: "2026-10-01", hasta: "2026-10-15" }, cuentas, ahora);
    expect(f.periodo).toBe("personalizado");
    expect(f.rango?.inicio.toISOString()).toBe("2026-10-01T05:00:00.000Z");
    expect(f.rango?.finExclusivo.toISOString()).toBe("2026-10-16T05:00:00.000Z");
    // Hoy/Ayer/Esta semana elegidos a propósito siguen ganando.
    expect(parsearFiltrosPedidos({ periodo: "hoy", desde: "2026-10-01" }, cuentas, ahora).periodo).toBe("hoy");
    // Campos de fecha vacíos (el formulario los manda igual) no cambian nada.
    expect(parsearFiltrosPedidos({ periodo: "mes", desde: "", hasta: "" }, cuentas, ahora).periodo).toBe("mes");
  });

  it("lista blanca: valores desconocidos caen al defecto", () => {
    const f = parsearFiltrosPedidos(
      { periodo: "siempre", marketplace: "amazon", estado: "paid", tienda: "ml:otra-empresa", pagina: "1e20" },
      cuentas,
      ahora
    );
    expect(f).toMatchObject({ periodo: "mes", marketplace: "todos", estado: null, tienda: null, pagina: 1 });
  });

  it("la tienda solo vale si es una cuenta de la empresa y no choca con el marketplace", () => {
    const tiendaFala = `falabella:${cuentas.falabella[0].id}`;
    expect(parsearFiltrosPedidos({ tienda: tiendaFala }, cuentas, ahora).tienda).toEqual({ marketplace: "falabella", id: cuentas.falabella[0].id });
    expect(parsearFiltrosPedidos({ tienda: `ml:${cuentas.falabella[0].id}` }, cuentas, ahora).tienda).toBeNull();
    expect(parsearFiltrosPedidos({ tienda: tiendaFala, marketplace: "ml" }, cuentas, ahora).tienda).toBeNull();
    expect(fuentesDeFiltros({ marketplace: "todos", tienda: { marketplace: "falabella", id: "x" } })).toEqual({ ml: false, falabella: true });
  });

  it("búsqueda recortada, página acotada y href solo con lo válido", () => {
    const f = parsearFiltrosPedidos({ q: ["  lámpara  ", "otro"], pagina: "999", estado: "enviado", marketplace: "ml" }, cuentas, ahora);
    expect(f.q).toBe("lámpara");
    expect(f.pagina).toBe(PAGINA_MAXIMA_PEDIDOS);
    expect(hrefPedidos(f, 2)).toBe("/panel/pedidos?marketplace=ml&estado=enviado&q=l%C3%A1mpara&pagina=2");
  });
});
