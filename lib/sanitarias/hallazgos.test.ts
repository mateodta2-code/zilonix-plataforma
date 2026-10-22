import { describe, expect, it } from "vitest";
import { calcularHallazgos, resumenDeAlerta, TIPOS } from "./hallazgos";
import type { AlertaInvima, PublicacionConsumible, RegistroSanitario } from "./tipos";

// Datos inventados a propósito (ningún dato real), uno por cada tipo de
// hallazgo que calcula calcularHallazgos(), cada uno en su propio SKU
// para no mezclar reglas entre sí.
const alertas: AlertaInvima[] = [
  {
    slug: "/alertas-sanitarias/1/demo1",
    numero: "1-2026",
    direccion: "Medicamentos",
    titulo: "Alerta sobre Producto X",
    motivo: "Comercialización ilegal",
    fecha: "2026-01-01",
    pdf: "/alertas-sanitarias/1/pdf",
    productos: [{ producto: "Producto X", registro: "RSA-0012345-2024", titular: "Titular X", lote: "L1" }],
    problema: "",
    con_detalle: true,
    visto: "2026-01-02T00:00:00.000Z",
  },
];

const publicaciones: PublicacionConsumible[] = [
  {
    item_id: "MCO1", alias: "cuentaA", sku: "DEMO1", titulo: "Suplemento Demo1", permalink: "https://ejemplo/1",
    marca: null, nombre_comercial: null, dominio: "SUPPLEMENT", imagen: null, registros: ["RSA-0012345-2024"],
  },
  {
    item_id: "MCO2", alias: "cuentaA", sku: "DEMO2", titulo: "Suplemento Demo2", permalink: "https://ejemplo/2",
    marca: null, nombre_comercial: null, dominio: "SUPPLEMENT", imagen: null, registros: ["RSA-0099999-2021"],
  },
  {
    item_id: "MCO3", alias: "cuentaA", sku: "DEMO3", titulo: "Suplemento Demo3", permalink: "https://ejemplo/3",
    marca: null, nombre_comercial: null, dominio: "SUPPLEMENT", imagen: null, registros: ["RSA-123-2024"],
  },
  {
    item_id: "MCO4", alias: "cuentaA", sku: "DEMO4", titulo: "Suplemento Demo4 Proteina Whey", permalink: "https://ejemplo/4",
    marca: null, nombre_comercial: null, dominio: "SUPPLEMENT", imagen: null, registros: ["RSA-0055555-2024"],
  },
  {
    item_id: "MCO5", alias: "cuentaA", sku: "DEMO5", titulo: "Suplemento Demo5", permalink: "https://ejemplo/5",
    marca: null, nombre_comercial: null, dominio: "SUPPLEMENT", imagen: null, registros: [],
  },
];

const registros: RegistroSanitario[] = [
  {
    registro: "RSA-0099999-2021",
    estado: "Vencido",
    filas: [{ rsynso: "RSA0099999-2021", producto: "Producto Demo2", estado: "Vencido", vence: "2024-01-15", titular: "Titular Demo2", grupo: "Suplementos" }],
  },
  { registro: "RSA-123-2024", estado: "NO_APARECE", filas: [] },
  {
    registro: "RSA-0055555-2024",
    estado: "Vigente",
    filas: [{ rsynso: "RSA0055555-2024", producto: "Un producto distinto totalmente diferente", estado: "Vigente", vence: null, titular: "Otro titular", grupo: "Alimentos" }],
  },
];

describe("calcularHallazgos", () => {
  const hallazgos = calcularHallazgos({
    alertas,
    publicaciones,
    registros,
    revisiones: { "vencido|RSA-0099999-2021|DEMO2": { estado: "revisado", nota: "ya se habló con el proveedor", por: "Ana" } },
  });

  it("calcula un hallazgo por cada caso (alerta, vencido, otroProducto, noAparece, sinRegistro)", () => {
    expect(hallazgos).toHaveLength(5);
    expect(new Set(hallazgos.map((h) => h.tipo))).toEqual(new Set(Object.keys(TIPOS)));
  });

  it("ordena por gravedad: alerta, vencido, otroProducto, noAparece, sinRegistro", () => {
    expect(hallazgos.map((h) => h.tipo)).toEqual(["alerta", "vencido", "otroProducto", "noAparece", "sinRegistro"]);
  });

  it("DEMO1 coincide con la alerta por el mismo registro sanitario (nivel seguro)", () => {
    const h = hallazgos.find((x) => x.sku === "DEMO1");
    expect(h?.tipo).toBe("alerta");
    expect(h?.nivel).toBe("seguro");
    expect(h?.alerta?.slug).toBe("/alertas-sanitarias/1/demo1");
  });

  it("DEMO2 está vencido y trae la revisión manual ya hecha", () => {
    const h = hallazgos.find((x) => x.sku === "DEMO2");
    expect(h?.tipo).toBe("vencido");
    expect(h?.invima?.vence).toBe("2024-01-15");
    expect(h?.revision).toEqual({ estado: "revisado", nota: "ya se habló con el proveedor", por: "Ana" });
  });

  it("DEMO3 no aparece en el INVIMA y su registro tiene formato raro (RSA de 2024 con menos de 5 dígitos)", () => {
    const h = hallazgos.find((x) => x.sku === "DEMO3");
    expect(h?.tipo).toBe("noAparece");
    expect(h?.nivel).toBe("raro");
  });

  it("DEMO4 tiene un registro que en el INVIMA es de un producto totalmente distinto", () => {
    const h = hallazgos.find((x) => x.sku === "DEMO4");
    expect(h?.tipo).toBe("otroProducto");
    expect(h?.invima?.producto).toBe("Un producto distinto totalmente diferente");
  });

  it("DEMO5 es un suplemento publicado sin ningún registro sanitario escrito", () => {
    const h = hallazgos.find((x) => x.sku === "DEMO5");
    expect(h?.tipo).toBe("sinRegistro");
  });

  it("sin revisión ni foto para una clave, esos campos quedan null", () => {
    const h = hallazgos.find((x) => x.sku === "DEMO1");
    expect(h?.revision).toBeNull();
    expect(h?.foto).toBeNull();
  });
});

describe("resumenDeAlerta", () => {
  it("arma las URLs completas del INVIMA a partir del slug/pdf guardados", () => {
    const resumen = resumenDeAlerta(alertas[0]);
    expect(resumen.url).toBe("https://www.invima.gov.co/alertas-sanitarias/1/demo1");
    expect(resumen.pdf).toBe("https://www.invima.gov.co/alertas-sanitarias/1/pdf");
  });

  it("\"nueva\" es true solo si se vio después de nuevasDesde", () => {
    expect(resumenDeAlerta(alertas[0], "2026-01-01T00:00:00.000Z").nueva).toBe(true);
    expect(resumenDeAlerta(alertas[0], "2026-01-03T00:00:00.000Z").nueva).toBe(false);
    expect(resumenDeAlerta(alertas[0], null).nueva).toBe(false);
  });
});
