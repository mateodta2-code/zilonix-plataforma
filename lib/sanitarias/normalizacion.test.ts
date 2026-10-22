import { describe, expect, it } from "vitest";
import { clavePartes, clavesDistintivas, contiene, extraerRegistros, formatoRaro, marcaDeNombre, normalizar, palabrasDelNombre, partesRegistro } from "./normalizacion";

describe("normalizar", () => {
  it("quita tildes, mayúsculas y signos, dejando solo letras/números separados por un espacio", () => {
    expect(normalizar("Colágeno Hidrolizado 500mg (x60 cápsulas)")).toBe("colageno hidrolizado 500mg x60 capsulas");
  });

  it("nunca revienta con null/undefined", () => {
    expect(normalizar(null)).toBe("");
    expect(normalizar(undefined)).toBe("");
  });
});

describe("extraerRegistros", () => {
  it("encuentra un registro RSA y lo normaliza a mayúsculas", () => {
    expect(extraerRegistros("Registro sanitario RSA-0012345-2024 vigente")).toEqual(["RSA-0012345-2024"]);
  });

  it("encuentra varios formatos distintos en el mismo texto (SD viejo y NSOC de cosméticos)", () => {
    expect(extraerRegistros("SD2007-0000316 y también NSOC36162-24CO")).toEqual(["NSOC36162-24CO", "SD2007-0000316"]);
  });

  it("no duplica el mismo registro escrito dos veces, aunque cambie mayúsculas/minúsculas", () => {
    expect(extraerRegistros("rsa-0012345-2024 ... RSA-0012345-2024")).toEqual(["RSA-0012345-2024"]);
  });

  it("sin ningún registro en el texto, devuelve una lista vacía", () => {
    expect(extraerRegistros("este texto no tiene ningún registro sanitario")).toEqual([]);
  });
});

describe("partesRegistro", () => {
  it("el mismo registro escrito con o sin ceros a la izquierda da las mismas partes", () => {
    expect(partesRegistro("RSA-0021928-2022")).toEqual(partesRegistro("RSA-021928-2022"));
  });

  it("separa prefijo, número (sin ceros) y año", () => {
    expect(partesRegistro("RSA-0012345-2024")).toEqual(["RSA", "12345", "2024"]);
  });

  it("formato SD viejo (año antes del número)", () => {
    expect(partesRegistro("SD2007-0000316")).toEqual(["SD", "316", "2007"]);
  });
});

describe("clavePartes", () => {
  it("junta las partes con \"|\" para poder comparar con Set.has", () => {
    expect(clavePartes("RSA-0012345-2024")).toBe("RSA|12345|2024");
  });
});

describe("formatoRaro", () => {
  it("un RSA de 2024 con menos de 5 dígitos es raro (el INVIMA numera con 5+ desde 2023)", () => {
    expect(formatoRaro("RSA-123-2024")).toBe(true);
  });

  it("un RSA de 2024 con 5 dígitos no es raro", () => {
    expect(formatoRaro("RSA-12345-2024")).toBe(false);
  });

  it("un RSA de antes de 2023 con pocos dígitos no es raro (esa regla no existía todavía)", () => {
    expect(formatoRaro("RSA-123-2020")).toBe(false);
  });

  it("un prefijo que no es RSA/NSA/PSA nunca es \"raro\" por esta regla", () => {
    expect(formatoRaro("SD2024-00123")).toBe(false);
  });
});

describe("clavesDistintivas", () => {
  it("quita ingredientes y palabras genéricas, deja solo lo distintivo", () => {
    expect(clavesDistintivas("Colágeno Hidrolizado con Vitamina C Marca Ejemplo")).toEqual(new Set(["ejemplo"]));
  });

  it("un texto solo de ingredientes genéricos no deja ninguna palabra distintiva", () => {
    expect(clavesDistintivas("Colágeno Hidrolizado Vitamina C Zinc Biotina").size).toBe(0);
  });
});

describe("palabrasDelNombre", () => {
  it("quita conectores y palabras vacías, pero conserva los ingredientes (sí importan acá)", () => {
    expect(palabrasDelNombre("Citrato de Magnesio + Citrato de Potasio")).toEqual(new Set(["citrato", "magnesio", "potasio"]));
  });
});

describe("marcaDeNombre", () => {
  it("extrae lo que sigue después de \"marca:\" o \"marcas\"", () => {
    expect(marcaDeNombre("Suplemento dietario marca: Ejemplo Pro")).toBe("Ejemplo Pro");
  });

  it("sin la palabra \"marca\", devuelve vacío", () => {
    expect(marcaDeNombre("Suplemento dietario Ejemplo Pro")).toBe("");
  });
});

describe("contiene", () => {
  it("true cuando todas las palabras del chico están en el grande", () => {
    expect(contiene(new Set(["a", "b", "c"]), new Set(["a", "b"]))).toBe(true);
  });

  it("false si falta una sola palabra del chico", () => {
    expect(contiene(new Set(["a", "b"]), new Set(["a", "c"]))).toBe(false);
  });

  it("un conjunto chico vacío siempre está contenido", () => {
    expect(contiene(new Set(["a"]), new Set())).toBe(true);
  });
});
