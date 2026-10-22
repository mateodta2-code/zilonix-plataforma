import { readFileSync } from "fs";
import { join } from "path";
import { describe, expect, it } from "vitest";
import { leerDetalleAlerta, leerTarjetasListado } from "./parsers-invima";

const FIXTURES = join(process.cwd(), "tests/fixtures/sanitarias");
const leerFixture = (nombre: string) => readFileSync(join(FIXTURES, nombre), "utf8");

describe("leerTarjetasListado (fixture: listado.html)", () => {
  const tarjetas = leerTarjetasListado(leerFixture("listado.html"));

  it("solo devuelve las tarjetas que sí tienen slug (la segunda, sin <a href>, se descarta)", () => {
    expect(tarjetas).toHaveLength(1);
  });

  it("lee slug, número, dirección, título, tipo, fecha y pdf de la tarjeta completa", () => {
    expect(tarjetas[0]).toEqual({
      slug: "/alertas-sanitarias/987/producto-de-prueba-x",
      numero: "Alerta Nº 123-2026",
      direccion: "Medicamentos y Productos Biológicos",
      titulo: "PRODUCTO DE PRUEBA X",
      tipo: "Alerta sanitaria",
      fecha: "2026-03-15",
      motivo: "Se alerta sobre la comercialización ilegal de Producto de Prueba X",
      pdf: "/alertas-sanitarias/987/pdf",
    });
  });
});

describe("leerDetalleAlerta (fixture: detalle.html)", () => {
  const detalle = leerDetalleAlerta(leerFixture("detalle.html"));

  it("lee las dos filas de la tabla de productos", () => {
    expect(detalle.productos).toHaveLength(2);
    expect(detalle.productos[0]).toEqual({
      producto: "PRODUCTO DE PRUEBA X 60 CAPSULAS",
      registro: "RSA-0012345-2024",
      titular: "COMERCIALIZADORA DE PRUEBA SAS",
      lote: "LOTE-0001",
    });
  });

  it("lee la descripción del problema como texto plano", () => {
    expect(detalle.problema).toBe(
      "Se evidenció la comercialización de este producto sin contar con el registro sanitario vigente ante el INVIMA."
    );
  });
});
