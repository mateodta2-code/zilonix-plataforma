import { describe, expect, it } from "vitest";
import {
  compararFotos,
  mensajeAlerta,
  normalizarPublicaciones,
  obtenerFechaCreacion,
  obtenerFechaCreacionCatalogo,
  obtenerFechaCreacionParaAntiguedad,
  obtenerPrecioAproximado,
  obtenerVendidosAproximado,
  type FotoComparable,
  type PublicacionesTienda,
} from "./alertas";

// Issue #175, punto 7 — toda esta prueba usa datos simulados a mano,
// nunca contra la API real de Mercado Libre (pedido explícito).
function foto(parcial: Partial<FotoComparable> = {}): FotoComparable {
  return {
    precio: 50_000,
    inventarioDisponible: 10,
    vendidos: 100,
    estado: "active",
    enCatalogo: true,
    ganaBotonCompra: true,
    publicaciones: null,
    ...parcial,
  };
}

// Issue #251 (corrección de Pablo, punto 4) — `fuente: "api"` por
// default: la comparación nuevas/eliminadas (el bloque de abajo) solo
// corre cuando LAS DOS fotos son de la API (snapshot completo); los
// tests de esa comparación necesitan marcarlo explícito para seguir
// probando ESE camino, no el de alertasDeTotalPublicaciones.
function publicaciones(parcial: Partial<PublicacionesTienda> = {}): PublicacionesTienda {
  return { total: null, visibles: [], fuente: "api", ...parcial };
}

describe("compararFotos — precio", () => {
  it("precio bajó: alerta precio_bajo con el % exacto", () => {
    const alertas = compararFotos("producto", foto({ precio: 100_000 }), foto({ precio: 80_000 }));
    expect(alertas).toEqual([{ tipo: "precio_bajo", detalle: { precioAnterior: 100_000, precioNuevo: 80_000, porcentaje: -20 } }]);
  });

  it("precio subió: alerta precio_subio con el % exacto", () => {
    const alertas = compararFotos("producto", foto({ precio: 80_000 }), foto({ precio: 100_000 }));
    expect(alertas).toEqual([{ tipo: "precio_subio", detalle: { precioAnterior: 80_000, precioNuevo: 100_000, porcentaje: 25 } }]);
  });

  it("precio igual: ninguna alerta", () => {
    expect(compararFotos("producto", foto({ precio: 50_000 }), foto({ precio: 50_000 }))).toEqual([]);
  });

  it("precio no disponible en cualquiera de las dos fotos: nunca inventa una alerta", () => {
    expect(compararFotos("producto", foto({ precio: null }), foto({ precio: 80_000 }))).toEqual([]);
    expect(compararFotos("producto", foto({ precio: 80_000 }), foto({ precio: null }))).toEqual([]);
  });
});

describe("compararFotos — catálogo y botón de compra", () => {
  it("entró al catálogo", () => {
    expect(compararFotos("producto", foto({ enCatalogo: false }), foto({ enCatalogo: true }))).toEqual([{ tipo: "entro_catalogo", detalle: {} }]);
  });

  it("salió del catálogo", () => {
    expect(compararFotos("producto", foto({ enCatalogo: true }), foto({ enCatalogo: false }))).toEqual([{ tipo: "salio_catalogo", detalle: {} }]);
  });

  it("sin dato de catálogo en alguna de las dos fotos: ninguna alerta", () => {
    expect(compararFotos("producto", foto({ enCatalogo: null }), foto({ enCatalogo: true }))).toEqual([]);
  });

  it("ganó el botón de compra", () => {
    expect(compararFotos("producto", foto({ ganaBotonCompra: false }), foto({ ganaBotonCompra: true }))).toEqual([
      { tipo: "gano_boton_compra", detalle: {} },
    ]);
  });

  it("perdió el botón de compra", () => {
    expect(compararFotos("producto", foto({ ganaBotonCompra: true }), foto({ ganaBotonCompra: false }))).toEqual([
      { tipo: "perdio_boton_compra", detalle: {} },
    ]);
  });
});

describe("compararFotos — inventario", () => {
  it("bajó el inventario: inventario_bajo con las unidades exactas", () => {
    const alertas = compararFotos("producto", foto({ inventarioDisponible: 10 }), foto({ inventarioDisponible: 7 }));
    expect(alertas).toEqual([{ tipo: "inventario_bajo", detalle: { inventarioAnterior: 10, inventarioActual: 7, unidades: 3 } }]);
  });

  it("subió el inventario (reabasto): nunca es una alerta", () => {
    expect(compararFotos("producto", foto({ inventarioDisponible: 5 }), foto({ inventarioDisponible: 10 }))).toEqual([]);
  });

  it("inventario igual: ninguna alerta", () => {
    expect(compararFotos("producto", foto({ inventarioDisponible: 10 }), foto({ inventarioDisponible: 10 }))).toEqual([]);
  });

  it("inventario no disponible en cualquiera de las dos fotos: nunca inventa una alerta", () => {
    expect(compararFotos("producto", foto({ inventarioDisponible: null }), foto({ inventarioDisponible: 5 }))).toEqual([]);
    expect(compararFotos("producto", foto({ inventarioDisponible: 5 }), foto({ inventarioDisponible: null }))).toEqual([]);
  });
});

describe("compararFotos — vendidos (sold_quantity real, confirmado por Mercado Libre)", () => {
  it("subió sold_quantity: alerta vendio_unidades con las unidades exactas", () => {
    const alertas = compararFotos("producto", foto({ vendidos: 100 }), foto({ vendidos: 103 }));
    expect(alertas).toEqual([{ tipo: "vendio_unidades", detalle: { vendidosAnterior: 100, vendidosActual: 103, unidades: 3 } }]);
  });

  it("sold_quantity igual: ninguna alerta", () => {
    expect(compararFotos("producto", foto({ vendidos: 100 }), foto({ vendidos: 100 }))).toEqual([]);
  });

  it("sold_quantity bajó (no debería pasar nunca en ML, pero por si acaso): nunca es una alerta negativa", () => {
    expect(compararFotos("producto", foto({ vendidos: 100 }), foto({ vendidos: 95 }))).toEqual([]);
  });

  it("vendidos no disponible (estimado/null) en cualquiera de las dos fotos: nunca inventa una alerta", () => {
    expect(compararFotos("producto", foto({ vendidos: null }), foto({ vendidos: 103 }))).toEqual([]);
    expect(compararFotos("producto", foto({ vendidos: 100 }), foto({ vendidos: null }))).toEqual([]);
  });

  it("vendio_unidades e inventario_bajo pueden coexistir el mismo día (son señales independientes)", () => {
    const alertas = compararFotos("producto", foto({ vendidos: 100, inventarioDisponible: 10 }), foto({ vendidos: 103, inventarioDisponible: 7 }));
    expect(alertas.map((a) => a.tipo).sort()).toEqual(["inventario_bajo", "vendio_unidades"]);
  });
});

describe("compararFotos — estado (pausada/finalizada)", () => {
  it("activa -> pausada: alerta pausada", () => {
    expect(compararFotos("producto", foto({ estado: "active" }), foto({ estado: "paused" }))).toEqual([{ tipo: "pausada", detalle: {} }]);
  });

  it("activa -> closed: alerta finalizada", () => {
    expect(compararFotos("producto", foto({ estado: "active" }), foto({ estado: "closed" }))).toEqual([{ tipo: "finalizada", detalle: {} }]);
  });

  it("ya estaba pausada y sigue pausada: ninguna alerta (no es una transición nueva)", () => {
    expect(compararFotos("producto", foto({ estado: "paused" }), foto({ estado: "paused" }))).toEqual([]);
  });

  it("sin estado (null) en la foto anterior: ninguna alerta, nunca asume que venía activa", () => {
    expect(compararFotos("producto", foto({ estado: null }), foto({ estado: "paused" }))).toEqual([]);
  });
});

describe("compararFotos — publicaciones de tienda (nuevas/eliminadas, las DOS fotos de la API)", () => {
  it("publicación nueva detectada", () => {
    const alertas = compararFotos(
      "tienda",
      foto({ publicaciones: publicaciones({ total: 1, visibles: [{ itemId: "MCO1", titulo: "Reloj", precio: 50_000 }] }) }),
      foto({
        publicaciones: publicaciones({
          total: 2,
          visibles: [
            { itemId: "MCO1", titulo: "Reloj", precio: 50_000 },
            { itemId: "MCO2", titulo: "Pulsera", precio: 20_000 },
          ],
        }),
      })
    );
    expect(alertas).toEqual([{ tipo: "publicacion_nueva", detalle: { publicaciones: [{ itemId: "MCO2", titulo: "Pulsera", precio: 20_000 }] } }]);
  });

  it("publicación eliminada detectada", () => {
    const alertas = compararFotos(
      "tienda",
      foto({
        publicaciones: publicaciones({
          total: 2,
          visibles: [
            { itemId: "MCO1", titulo: "Reloj", precio: 50_000 },
            { itemId: "MCO2", titulo: "Pulsera", precio: 20_000 },
          ],
        }),
      }),
      foto({ publicaciones: publicaciones({ total: 1, visibles: [{ itemId: "MCO1", titulo: "Reloj", precio: 50_000 }] }) })
    );
    expect(alertas).toEqual([{ tipo: "publicacion_eliminada", detalle: { publicaciones: [{ itemId: "MCO2", titulo: "Pulsera", precio: 20_000 }] } }]);
  });

  it("nuevas Y eliminadas en el mismo día: las dos alertas aparecen", () => {
    const alertas = compararFotos(
      "tienda",
      foto({ publicaciones: publicaciones({ total: 1, visibles: [{ itemId: "MCO1", titulo: "Se va", precio: 1000 }] }) }),
      foto({ publicaciones: publicaciones({ total: 1, visibles: [{ itemId: "MCO2", titulo: "Llega", precio: 2000 }] }) })
    );
    expect(alertas).toHaveLength(2);
    expect(alertas.map((a) => a.tipo).sort()).toEqual(["publicacion_eliminada", "publicacion_nueva"]);
  });

  it("mismas publicaciones: ninguna alerta", () => {
    const lista = publicaciones({ total: 1, visibles: [{ itemId: "MCO1", titulo: "Reloj", precio: 50_000 }] });
    expect(compararFotos("tienda", foto({ publicaciones: lista }), foto({ publicaciones: lista }))).toEqual([]);
  });

  it("tipo = producto nunca compara publicaciones, aunque vinieran pobladas por error", () => {
    const lista = publicaciones({ total: 1, visibles: [{ itemId: "MCO1", titulo: "Reloj", precio: 50_000 }] });
    expect(compararFotos("producto", foto({ publicaciones: publicaciones() }), foto({ publicaciones: lista }))).toEqual([]);
  });

  it("sin snapshot de publicaciones en alguna de las dos fotos: ninguna alerta", () => {
    expect(compararFotos("tienda", foto({ publicaciones: null }), foto({ publicaciones: publicaciones() }))).toEqual([]);
  });
});

// Issue #251 (corrección de Pablo, punto 4) — cuando CUALQUIERA de las
// dos fotos viene de la página (extensión), `visibles` es solo lo
// visible en esa carga (~48), nunca el total real — comparar esos ids
// como si fueran snapshots completos marcaría nuevas/eliminadas
// falsas. Solo el TOTAL es comparable en ese caso.
describe("compararFotos — publicaciones de tienda, alguna foto de la página (solo compara el total)", () => {
  it("el total subió, fuente página en la foto actual: publicacion_nueva con estimadoPorTotal, nunca nuevas/eliminadas por id", () => {
    const alertas = compararFotos(
      "tienda",
      foto({ publicaciones: publicaciones({ total: 10, visibles: [{ itemId: "MCO1", titulo: "Reloj", precio: 50_000 }] }) }),
      foto({ publicaciones: publicaciones({ total: 12, visibles: [{ itemId: "MCO9", titulo: null, precio: null }], fuente: "pagina" }) })
    );
    expect(alertas).toEqual([{ tipo: "publicacion_nueva", detalle: { estimadoPorTotal: true, totalAnterior: 10, totalActual: 12, diferencia: 2 } }]);
  });

  it("el total bajó, fuente página en la foto anterior: publicacion_eliminada con estimadoPorTotal", () => {
    const alertas = compararFotos(
      "tienda",
      foto({ publicaciones: publicaciones({ total: 12, visibles: [{ itemId: "MCO9", titulo: null, precio: null }], fuente: "pagina" }) }),
      foto({ publicaciones: publicaciones({ total: 10, visibles: [{ itemId: "MCO1", titulo: "Reloj", precio: 50_000 }] }) })
    );
    expect(alertas).toEqual([{ tipo: "publicacion_eliminada", detalle: { estimadoPorTotal: true, totalAnterior: 12, totalActual: 10, diferencia: 2 } }]);
  });

  it("el total no cambió: ninguna alerta, aunque los ids visibles sean distintos (solo son páginas distintas del mismo listado)", () => {
    const alertas = compararFotos(
      "tienda",
      foto({ publicaciones: publicaciones({ total: 10, visibles: [{ itemId: "MCO1", titulo: "Reloj", precio: 50_000 }], fuente: "pagina" }) }),
      foto({ publicaciones: publicaciones({ total: 10, visibles: [{ itemId: "MCO9", titulo: null, precio: null }], fuente: "pagina" }) })
    );
    expect(alertas).toEqual([]);
  });

  it("alguno de los dos totales es null: ninguna alerta, nunca un diferencia inventada", () => {
    const alertas = compararFotos(
      "tienda",
      foto({ publicaciones: publicaciones({ total: null, visibles: [], fuente: "pagina" }) }),
      foto({ publicaciones: publicaciones({ total: 10, visibles: [] }) })
    );
    expect(alertas).toEqual([]);
  });
});

describe("normalizarPublicaciones — issue #251 (corrección de Pablo, punto 3)", () => {
  it("null se mantiene null", () => {
    expect(normalizarPublicaciones(null)).toBeNull();
  });

  it("formato nuevo ({total, visibles, fuente}) se devuelve tal cual", () => {
    const dato = { total: 5, visibles: [{ itemId: "MCO1", titulo: "Reloj", precio: 50_000 }], fuente: "pagina" };
    expect(normalizarPublicaciones(dato)).toEqual(dato);
  });

  it("formato viejo (array plano, antes de total/fuente): se envuelve como {total:null, visibles, fuente:'api'}, nunca revienta", () => {
    const visiblesViejos = [{ itemId: "MCO1", titulo: "Reloj", precio: 50_000 }];
    expect(normalizarPublicaciones(visiblesViejos)).toEqual({ total: null, visibles: visiblesViejos, fuente: "api" });
  });

  it("objeto sin fuente reconocida (dato corrupto o futuro): se asume 'api', nunca 'pagina' sin confirmarlo", () => {
    expect(normalizarPublicaciones({ total: 3, visibles: [] })).toEqual({ total: 3, visibles: [], fuente: "api" });
  });

  it("basura (string, número): null, nunca revienta", () => {
    expect(normalizarPublicaciones("no es un objeto")).toBeNull();
    expect(normalizarPublicaciones(42)).toBeNull();
  });

  // Issue #252 (smoke de staging) — un objeto `{vendidosAproximado}`
  // (el OTRO formato que vive en esta misma columna, para tipo =
  // "producto") nunca se confunde con el de tienda: no tiene
  // `visibles`, así que esto tiene que devolver null, nunca un
  // {total:null, visibles:[], fuente:"api"} inventado.
  it("{vendidosAproximado} (el formato de producto en la misma columna) -> null, nunca se confunde con tienda", () => {
    expect(normalizarPublicaciones({ vendidosAproximado: 500 })).toBeNull();
  });
});

describe("obtenerVendidosAproximado — issue #252 (smoke de staging)", () => {
  it("lee el número cuando el objeto trae {vendidosAproximado}", () => {
    expect(obtenerVendidosAproximado({ vendidosAproximado: 500 })).toBe(500);
  });

  it("null, undefined, o el formato de tienda ({total,visibles,fuente}) -> null, nunca se confunde", () => {
    expect(obtenerVendidosAproximado(null)).toBeNull();
    expect(obtenerVendidosAproximado(undefined)).toBeNull();
    expect(obtenerVendidosAproximado({ total: 10, visibles: [], fuente: "api" })).toBeNull();
  });

  it("basura (array, string, número) -> null, nunca revienta", () => {
    expect(obtenerVendidosAproximado([1, 2, 3])).toBeNull();
    expect(obtenerVendidosAproximado("500")).toBeNull();
    expect(obtenerVendidosAproximado(500)).toBeNull();
  });
});

describe("obtenerPrecioAproximado — issue #252 (smoke de staging, punto 3)", () => {
  it("lee el número cuando el objeto trae {precioAproximado}", () => {
    expect(obtenerPrecioAproximado({ precioAproximado: 89900 })).toBe(89900);
  });

  it("null, undefined, o el formato de tienda ({total,visibles,fuente}) -> null, nunca se confunde", () => {
    expect(obtenerPrecioAproximado(null)).toBeNull();
    expect(obtenerPrecioAproximado(undefined)).toBeNull();
    expect(obtenerPrecioAproximado({ total: 10, visibles: [], fuente: "api" })).toBeNull();
  });

  it("{vendidosAproximado} solo (sin precioAproximado) -> null, nunca confunde los dos campos", () => {
    expect(obtenerPrecioAproximado({ vendidosAproximado: 500 })).toBeNull();
  });

  it("basura (array, string, número) -> null, nunca revienta", () => {
    expect(obtenerPrecioAproximado([1, 2, 3])).toBeNull();
    expect(obtenerPrecioAproximado("89900")).toBeNull();
    expect(obtenerPrecioAproximado(89900)).toBeNull();
  });
});

describe("obtenerFechaCreacion / obtenerFechaCreacionCatalogo — issue #262 (revisión de Pablo, punto 2): dos campos SEPARADOS, nunca confundidos", () => {
  it("obtenerFechaCreacion lee {fechaCreacion} (date_created del ÍTEM), nunca {fechaCreacionCatalogo}", () => {
    expect(obtenerFechaCreacion({ fechaCreacion: "2024-01-01T00:00:00.000Z" })).toBe("2024-01-01T00:00:00.000Z");
    expect(obtenerFechaCreacion({ fechaCreacionCatalogo: "2025-03-15T00:00:00.000Z" })).toBeNull();
  });

  it("obtenerFechaCreacionCatalogo lee {fechaCreacionCatalogo} (date_created del CATÁLOGO), nunca {fechaCreacion}", () => {
    expect(obtenerFechaCreacionCatalogo({ fechaCreacionCatalogo: "2025-03-15T00:00:00.000Z" })).toBe("2025-03-15T00:00:00.000Z");
    // Issue #262, punto bloqueante — `fechaCreacion`, aunque tenga un
    // valor real, es la fecha de un ÍTEM (ganador de una oferta,
    // nunca del catálogo) — jamás debe leerse acá como si fuera la
    // del catálogo.
    expect(obtenerFechaCreacionCatalogo({ fechaCreacion: "2024-01-01T00:00:00.000Z" })).toBeNull();
  });

  it("null/undefined/el formato de tienda/basura -> null en los dos, nunca revientan", () => {
    for (const fn of [obtenerFechaCreacion, obtenerFechaCreacionCatalogo]) {
      expect(fn(null)).toBeNull();
      expect(fn(undefined)).toBeNull();
      expect(fn({ total: 10, visibles: [], fuente: "api" })).toBeNull();
      expect(fn([1, 2, 3])).toBeNull();
      expect(fn("2024-01-01")).toBeNull();
    }
  });
});

describe("obtenerFechaCreacionParaAntiguedad — issue #262 (revisión de Pablo, punto 2): un solo punto de entrada según recurso_ml", () => {
  const publicaciones = { fechaCreacion: "2024-01-01T00:00:00.000Z", fechaCreacionCatalogo: "2025-03-15T00:00:00.000Z" };

  it('recurso_ml "item": usa fechaCreacion, nunca fechaCreacionCatalogo', () => {
    expect(obtenerFechaCreacionParaAntiguedad(publicaciones, "item")).toBe("2024-01-01T00:00:00.000Z");
  });

  it('recurso_ml "product": usa fechaCreacionCatalogo, nunca fechaCreacion (el bug bloqueante que motivó esta función)', () => {
    expect(obtenerFechaCreacionParaAntiguedad(publicaciones, "product")).toBe("2025-03-15T00:00:00.000Z");
  });

  it('recurso_ml "seller" o null: siempre null — una tienda no tiene date_created propio', () => {
    expect(obtenerFechaCreacionParaAntiguedad(publicaciones, "seller")).toBeNull();
    expect(obtenerFechaCreacionParaAntiguedad(publicaciones, null)).toBeNull();
  });
});

describe("compararFotos — varias alertas el mismo día", () => {
  it("precio bajó Y perdió el botón de compra el mismo día: las dos alertas aparecen", () => {
    const alertas = compararFotos(
      "producto",
      foto({ precio: 100_000, ganaBotonCompra: true }),
      foto({ precio: 80_000, ganaBotonCompra: false })
    );
    expect(alertas.map((a) => a.tipo).sort()).toEqual(["perdio_boton_compra", "precio_bajo"]);
  });
});

describe("mensajeAlerta — texto en español, nunca afirma una venta que ML no confirma", () => {
  it("inventario_bajo dice 'posible venta', nunca 'vendió'", () => {
    const mensaje = mensajeAlerta({ tipo: "inventario_bajo", detalle: { inventarioAnterior: 10, inventarioActual: 7, unidades: 3 } });
    expect(mensaje).toMatch(/posible venta/i);
    expect(mensaje).not.toMatch(/vendió/i);
    expect(mensaje).toContain("3");
  });

  it("vendio_unidades SÍ puede decir 'vendió' (contador real de ML, nunca estimado)", () => {
    const mensaje = mensajeAlerta({ tipo: "vendio_unidades", detalle: { vendidosAnterior: 100, vendidosActual: 103, unidades: 3 } });
    expect(mensaje).toMatch(/vendió/i);
    expect(mensaje).toContain("3");
  });

  it("precio_bajo incluye el antes/después y el %", () => {
    const mensaje = mensajeAlerta({ tipo: "precio_bajo", detalle: { precioAnterior: 100_000, precioNuevo: 80_000, porcentaje: -20 } });
    expect(mensaje).toMatch(/100\.000/);
    expect(mensaje).toMatch(/80\.000/);
    expect(mensaje).toMatch(/-20/);
  });

  it("publicacion_nueva en singular vs. plural", () => {
    const unaSola = mensajeAlerta({ tipo: "publicacion_nueva", detalle: { publicaciones: [{ itemId: "MCO1", titulo: "Reloj", precio: 1 }] } });
    expect(unaSola).toContain("Reloj");
    const varias = mensajeAlerta({
      tipo: "publicacion_nueva",
      detalle: {
        publicaciones: [
          { itemId: "MCO1", titulo: "Reloj", precio: 1 },
          { itemId: "MCO2", titulo: "Pulsera", precio: 1 },
        ],
      },
    });
    expect(varias).toMatch(/2 publicaciones nuevas/);
  });

  // Issue #251 (corrección de Pablo, punto 4) — mensaje aparte cuando
  // viene de alertasDeTotalPublicaciones (fuente página): nunca
  // afirma cuáles publicaciones cambiaron, solo el total.
  it("publicacion_nueva/eliminada con estimadoPorTotal: menciona el total, nunca inventa cuáles cambiaron", () => {
    const subieron = mensajeAlerta({ tipo: "publicacion_nueva", detalle: { estimadoPorTotal: true, totalAnterior: 10, totalActual: 12, diferencia: 2 } });
    expect(subieron).toMatch(/10/);
    expect(subieron).toMatch(/12/);
    expect(subieron).not.toMatch(/Reloj|itemId/i);

    const bajaron = mensajeAlerta({ tipo: "publicacion_eliminada", detalle: { estimadoPorTotal: true, totalAnterior: 12, totalActual: 10, diferencia: 2 } });
    expect(bajaron).toMatch(/12/);
    expect(bajaron).toMatch(/10/);
  });
});
