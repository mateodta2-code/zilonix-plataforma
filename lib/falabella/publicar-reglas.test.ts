import { describe, expect, it } from "vitest";
import { construirBorrador, construirEan, formatearFechaOferta, xmlImagenes, xmlProductCreate } from "./publicar-reglas";

const base = {
  sku: "FULPun6322",
  titulo: "Esterilizador De Biberones Electrico",
  descripcion: "Descripción larga del producto.",
  modelo: "Philips",
  precioOferta: 100_000,
  stock: 5,
  categoriaId: 123,
  imagenes: ["https://x.com/1.jpg", "https://x.com/2.jpg"],
  ahora: new Date("2026-11-28T15:00:00Z"),
};

describe("construirEan", () => {
  it("usa el prefijo + los últimos 4 dígitos del SKU (ejemplo de Mateo)", () => {
    expect(construirEan("FULPun6322")).toBe("90157859356322");
  });
  it("devuelve null si el SKU no termina en 4 dígitos", () => {
    expect(construirEan("ABC")).toBeNull();
    expect(construirEan("FULPunABCD")).toBeNull();
  });
});

describe("construirBorrador", () => {
  it("aplica las reglas de Mateo y no tiene problemas en el caso feliz", () => {
    const b = construirBorrador(base);
    expect(b.problemas).toEqual([]);
    expect(b.marca).toBe("GENERICO");
    expect(b.atributos.Modelo).toBe("Philips");
    expect(b.precioOferta).toBe(100_000);
    expect(b.precioNormal).toBe(125_000);
    expect(b.iva).toBe("19");
    expect(b.medidas).toEqual({ largo: 25, ancho: 15, alto: 25, peso: 1 });
    expect(b.bodega).toBe("Bodega_envio_01");
  });

  it("la oferta dura 30 días, en hora de Colombia", () => {
    const b = construirBorrador(base);
    expect(b.ofertaDesde).toBe("2026-11-28 10:00:00");
    expect(b.ofertaHasta).toBe("2026-12-28 10:00:00");
  });

  it("permite medidas reales cuando el producto no cabe", () => {
    const b = construirBorrador({ ...base, medidas: { largo: 60, peso: 4.5 } });
    expect(b.medidas).toEqual({ largo: 60, ancho: 15, alto: 25, peso: 4.5 });
  });

  it("bloquea un título de más de 60 caracteres, sin recortarlo en silencio", () => {
    const b = construirBorrador({ ...base, titulo: "a".repeat(61) });
    expect(b.problemas.join(" ")).toMatch(/61 caracteres/);
    expect(b.titulo).toHaveLength(61);
  });

  it("bloquea paquetes x2/x3 y suplementos", () => {
    expect(construirBorrador({ ...base, titulo: "Esterilizador x2" }).problemas.join(" ")).toMatch(/x2\/x3/);
    expect(construirBorrador({ ...base, titulo: "Pack 3 biberones" }).problemas.length).toBeGreaterThan(0);
    expect(construirBorrador({ ...base, titulo: "Suplemento de colágeno" }).problemas.length).toBeGreaterThan(0);
    expect(construirBorrador({ ...base, titulo: "Lámpara 3X1 led" }).problemas.length).toBeGreaterThan(0);
  });

  it("no se confunde con palabras normales que contienen x", () => {
    expect(construirBorrador({ ...base, titulo: "Maxi organizador de baño" }).problemas).toEqual([]);
  });

  it("quita imágenes repetidas, limita a 8 y avisa", () => {
    const urls = Array.from({ length: 10 }, (_, i) => `https://x.com/${i}.jpg`);
    const b = construirBorrador({ ...base, imagenes: ["https://x.com/0.jpg", ...urls] });
    expect(b.imagenes).toHaveLength(8);
    expect(b.imagenes[0]).toBe("https://x.com/0.jpg");
    expect(b.avisos.length).toBe(2);
  });

  it("exige imágenes https y al menos una", () => {
    expect(construirBorrador({ ...base, imagenes: [] }).problemas.join(" ")).toMatch(/al menos una imagen/);
    expect(construirBorrador({ ...base, imagenes: ["http://x.com/1.jpg"] }).problemas.join(" ")).toMatch(/https/);
  });

  it("bloquea sin SKU con dígitos, sin precio, sin categoría o sin marca real", () => {
    const b = construirBorrador({ ...base, sku: "ABC", precioOferta: 0, categoriaId: 0, modelo: " " });
    expect(b.problemas.length).toBe(4);
  });
});

describe("XML", () => {
  it("ProductCreate incluye marca, EAN, precios, oferta, IVA y el atributo Modelo", () => {
    const xml = xmlProductCreate(construirBorrador(base));
    expect(xml).toContain("<Brand>GENERICO</Brand>");
    expect(xml).toContain("<ProductId>90157859356322</ProductId>");
    expect(xml).toContain("<Price>125000</Price>");
    expect(xml).toContain("<SpecialPrice>100000</SpecialPrice>");
    expect(xml).toContain("<OperatorCode>faco</OperatorCode>");
    expect(xml).toContain("<TaxPercentage>19</TaxPercentage>");
    expect(xml).toContain("<Modelo>Philips</Modelo>");
  });

  it("escapa texto y protege el CDATA de la descripción", () => {
    const xml = xmlProductCreate(construirBorrador({ ...base, titulo: "A & B <x>", descripcion: "uno ]]> dos <b>ok</b>" }));
    expect(xml).toContain("<Name>A &amp; B &lt;x&gt;</Name>");
    expect(xml).not.toMatch(/\]\]>[^<]*dos/);
  });

  it("ignora atributos con nombre de tag peligroso", () => {
    const xml = xmlProductCreate(construirBorrador({ ...base, atributos: { "Mal><x": "1", Color: "Rojo" } }));
    expect(xml).toContain("<Color>Rojo</Color>");
    expect(xml).not.toContain("Mal><x");
  });

  it("Image conserva el orden (la primera es la portada)", () => {
    const xml = xmlImagenes("SKU1234", ["https://a/1.jpg", "https://a/2.jpg"]);
    expect(xml.indexOf("1.jpg")).toBeLessThan(xml.indexOf("2.jpg"));
  });
});

describe("formatearFechaOferta", () => {
  it("resta 5 horas (Colombia)", () => {
    expect(formatearFechaOferta(new Date("2026-01-01T03:00:00Z"))).toBe("2025-12-31 22:00:00");
  });
});
