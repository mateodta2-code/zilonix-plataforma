import { describe, expect, it } from "vitest";
import { debeMostrarResumenBusquedaVacia, lineasResumenBusquedaVacia } from "./resumenBusquedaVacia";
import type { TrabajoBusquedaCliente } from "./tipos-cliente";

function trabajo(overrides: Partial<TrabajoBusquedaCliente> = {}): TrabajoBusquedaCliente {
  return {
    id: "job-1",
    empresaId: "empresa-1",
    creadoTs: Date.now(),
    terminadoTs: null,
    cuentas: [],
    ...overrides,
  };
}

// Bug real en staging (rama fix-promociones-buscar, Refs #44) — sin
// esta distinción, una búsqueda que SÍ corrió pero terminó sin
// candidatos se veía igual que una página recién abierta donde nunca
// se corrió nada ("todavía no hay resultados — dale Buscar arriba").
describe("debeMostrarResumenBusquedaVacia", () => {
  it("sin trabajo (nunca se buscó en esta sesión): false, nunca el resumen por cuenta", () => {
    expect(debeMostrarResumenBusquedaVacia(null, 0)).toBe(false);
  });

  it("trabajo en curso (todavía sin terminadoTs): false, aunque candidatos siga en 0", () => {
    expect(debeMostrarResumenBusquedaVacia(trabajo({ terminadoTs: null }), 0)).toBe(false);
  });

  it("trabajo terminado con candidatos reales: false, se muestra la tabla de resultados, no el resumen", () => {
    expect(debeMostrarResumenBusquedaVacia(trabajo({ terminadoTs: Date.now() }), 3)).toBe(false);
  });

  it("trabajo terminado sin ningún candidato: true — exactamente el bug real reportado", () => {
    expect(debeMostrarResumenBusquedaVacia(trabajo({ terminadoTs: Date.now() }), 0)).toBe(true);
  });
});

describe("lineasResumenBusquedaVacia", () => {
  it("una línea por cuenta, con el motivo real cuando la cuenta quedó en error", () => {
    const lineas = lineasResumenBusquedaVacia(
      trabajo({
        terminadoTs: Date.now(),
        cuentas: [
          {
            cuentaId: "c1",
            nickname: "Cuenta sana",
            estado: "listo",
            productosRevisados: 40,
            itemsConPromociones: 0,
            catalogoIncompleto: false,
            error: null,
          },
          {
            cuentaId: "c2",
            nickname: "Cuenta sin permiso",
            estado: "error",
            productosRevisados: 5,
            itemsConPromociones: 0,
            catalogoIncompleto: false,
            error: "Reconectá esta cuenta en Conectar Mercado Libre — falta permiso de Promociones (scope).",
          },
        ],
      })
    );

    expect(lineas).toHaveLength(2);
    expect(lineas[0]).toEqual({ cuentaId: "c1", texto: "Cuenta sana: 40 producto(s) revisados, 0 con promociones.", tieneError: false });
    expect(lineas[1]).toEqual({
      cuentaId: "c2",
      texto: "Cuenta sin permiso: 5 producto(s) revisados, 0 con promociones. Reconectá esta cuenta en Conectar Mercado Libre — falta permiso de Promociones (scope).",
      tieneError: true,
    });
  });

  it("sin cuentas: lista vacía, nunca lanza", () => {
    expect(lineasResumenBusquedaVacia(trabajo({ terminadoTs: Date.now(), cuentas: [] }))).toEqual([]);
  });
});
