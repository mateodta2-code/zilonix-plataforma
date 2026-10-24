import { describe, expect, it } from "vitest";
import { compararFotos, mensajeAlerta, type FotoComparable } from "./alertas";

// Issue #175, punto 7 — toda esta prueba usa datos simulados a mano,
// nunca contra la API real de Mercado Libre (pedido explícito).
function foto(parcial: Partial<FotoComparable> = {}): FotoComparable {
  return {
    precio: 50_000,
    inventarioDisponible: 10,
    estado: "active",
    enCatalogo: true,
    ganaBotonCompra: true,
    publicaciones: null,
    ...parcial,
  };
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

describe("compararFotos — publicaciones de tienda (nuevas/eliminadas)", () => {
  it("publicación nueva detectada", () => {
    const alertas = compararFotos(
      "tienda",
      foto({ publicaciones: [{ itemId: "MCO1", titulo: "Reloj", precio: 50_000 }] }),
      foto({
        publicaciones: [
          { itemId: "MCO1", titulo: "Reloj", precio: 50_000 },
          { itemId: "MCO2", titulo: "Pulsera", precio: 20_000 },
        ],
      })
    );
    expect(alertas).toEqual([{ tipo: "publicacion_nueva", detalle: { publicaciones: [{ itemId: "MCO2", titulo: "Pulsera", precio: 20_000 }] } }]);
  });

  it("publicación eliminada detectada", () => {
    const alertas = compararFotos(
      "tienda",
      foto({
        publicaciones: [
          { itemId: "MCO1", titulo: "Reloj", precio: 50_000 },
          { itemId: "MCO2", titulo: "Pulsera", precio: 20_000 },
        ],
      }),
      foto({ publicaciones: [{ itemId: "MCO1", titulo: "Reloj", precio: 50_000 }] })
    );
    expect(alertas).toEqual([{ tipo: "publicacion_eliminada", detalle: { publicaciones: [{ itemId: "MCO2", titulo: "Pulsera", precio: 20_000 }] } }]);
  });

  it("nuevas Y eliminadas en el mismo día: las dos alertas aparecen", () => {
    const alertas = compararFotos(
      "tienda",
      foto({ publicaciones: [{ itemId: "MCO1", titulo: "Se va", precio: 1000 }] }),
      foto({ publicaciones: [{ itemId: "MCO2", titulo: "Llega", precio: 2000 }] })
    );
    expect(alertas).toHaveLength(2);
    expect(alertas.map((a) => a.tipo).sort()).toEqual(["publicacion_eliminada", "publicacion_nueva"]);
  });

  it("mismas publicaciones: ninguna alerta", () => {
    const lista = [{ itemId: "MCO1", titulo: "Reloj", precio: 50_000 }];
    expect(compararFotos("tienda", foto({ publicaciones: lista }), foto({ publicaciones: lista }))).toEqual([]);
  });

  it("tipo = producto nunca compara publicaciones, aunque vinieran pobladas por error", () => {
    const lista = [{ itemId: "MCO1", titulo: "Reloj", precio: 50_000 }];
    expect(compararFotos("producto", foto({ publicaciones: [] }), foto({ publicaciones: lista }))).toEqual([]);
  });

  it("sin snapshot de publicaciones en alguna de las dos fotos: ninguna alerta", () => {
    expect(compararFotos("tienda", foto({ publicaciones: null }), foto({ publicaciones: [] }))).toEqual([]);
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
});
