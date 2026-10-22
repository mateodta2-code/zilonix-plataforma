import { describe, expect, it } from "vitest";
import { coincidenciaConAlerta, prepararAlertas, prepararProducto } from "./coincidencias";
import type { AlertaInvima } from "./tipos";

function alerta(datos: Partial<AlertaInvima>): AlertaInvima {
  return {
    slug: "/alertas-sanitarias/1/ejemplo",
    numero: "1-2026",
    direccion: "Medicamentos",
    titulo: "",
    motivo: "",
    fecha: "2026-01-01",
    pdf: "/alertas-sanitarias/1/pdf",
    productos: [],
    problema: "",
    con_detalle: true,
    ...datos,
  };
}

describe("prepararAlertas", () => {
  it("descarta las alertas sin detalle (con_detalle: false)", () => {
    const preparadas = prepararAlertas([alerta({ titulo: "Sin detalle", con_detalle: false })]);
    expect(preparadas).toHaveLength(0);
  });

  it("junta el registro de los productos en regs, ya pasado por clavePartes", () => {
    const [p] = prepararAlertas([
      alerta({
        titulo: "Alerta de ejemplo",
        productos: [{ producto: "Producto de prueba", registro: "RSA-0012345-2024", titular: "Titular", lote: "L1" }],
      }),
    ]);
    expect(p.regs.has("RSA|12345|2024")).toBe(true);
  });

  it("usa el título como nombre cuando la alerta no trae productos", () => {
    const [p] = prepararAlertas([alerta({ titulo: "Mezcla sin marca de ejemplo" })]);
    expect(p.nombres).toEqual(["Mezcla sin marca de ejemplo"]);
  });
});

describe("prepararProducto", () => {
  it("separa las palabras distintivas de las marcas (solo cuentan si tienen algo distintivo)", () => {
    const producto = prepararProducto({ marcas: ["Resveratrol"], textos: [] });
    // "Resveratrol" es un ingrediente genérico (está en la lista GENERICAS):
    // como marca, no dice nada del producto, así que no cuenta.
    expect(producto.marcasPropias).toEqual([]);
  });

  it("una marca distintiva sí queda en marcasPropias, normalizada y con espacios a los lados", () => {
    const producto = prepararProducto({ marcas: ["Ejemplopro"], textos: [] });
    expect(producto.marcasPropias).toEqual([" ejemplopro "]);
  });
});

describe("coincidenciaConAlerta", () => {
  it("nivel \"seguro\": el mismo registro sanitario (aunque esté escrito distinto)", () => {
    const [preparada] = prepararAlertas([
      alerta({
        titulo: "Alerta de ejemplo",
        productos: [{ producto: "Producto de prueba", registro: "RSA-0012345-2024", titular: "Comercializadora", lote: "L1" }],
      }),
    ]);
    const producto = prepararProducto({ registros: ["RSA-12345-2024"], textos: ["Producto nuestro"] });

    const c = coincidenciaConAlerta(producto, preparada);
    expect(c?.nivel).toBe("seguro");
  });

  it("nivel \"marca\": la alerta menciona una marca distintiva que también es nuestra", () => {
    const [preparada] = prepararAlertas([alerta({ titulo: "Autoridades alertan sobre producto marca Ejemplopro" })]);
    const producto = prepararProducto({ marcas: ["Ejemplopro"], textos: ["Suplemento Ejemplopro 60 cápsulas"] });

    const c = coincidenciaConAlerta(producto, preparada);
    expect(c?.nivel).toBe("marca");
  });

  it("nivel \"nombre\": sin marca, el nombre del producto de la alerta coincide con el nuestro", () => {
    const [preparada] = prepararAlertas([
      alerta({
        titulo: "Alerta de ejemplo",
        productos: [{ producto: "Suplemento Tribulus Maximo", titular: "Comercializadora", registro: "", lote: "" }],
      }),
    ]);
    const producto = prepararProducto({ textos: ["Tribulus Maximo 90 cápsulas"] });

    const c = coincidenciaConAlerta(producto, preparada);
    expect(c?.nivel).toBe("nombre");
  });

  it("sin ningún punto en común, no hay coincidencia (null)", () => {
    const [preparada] = prepararAlertas([
      alerta({
        titulo: "Alerta sobre un producto totalmente distinto",
        productos: [{ producto: "Crema facial de otra categoría", titular: "Otra empresa", registro: "", lote: "" }],
      }),
    ]);
    const producto = prepararProducto({ registros: ["RSA-9999999-2024"], marcas: ["NuestraMarca"], textos: ["Proteína en polvo nuestra"] });

    expect(coincidenciaConAlerta(producto, preparada)).toBeNull();
  });
});
