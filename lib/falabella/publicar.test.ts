import { afterEach, describe, expect, it, vi } from "vitest";
import { aplanarHojas, leerArbolCategorias, leerAtributos, leerMarcas } from "./catalogo";
import { BorradorConProblemasError, consultarFeed, enviarImagenes, enviarProductCreate, leerEstadoFeed } from "./publicar";
import { construirBorrador } from "./publicar-reglas";

const cred = { userId: "a@b.com", apiKey: "clave", sellerId: "TIENDA_1" };
const borrador = construirBorrador({
  sku: "FULPun6322",
  titulo: "Esterilizador De Biberones",
  descripcion: "Descripción larga.",
  modelo: "Philips",
  precioOferta: 100000,
  stock: 3,
  categoriaId: 10,
  imagenes: ["https://x.com/1.jpg"],
});

function ok(body: unknown, head: unknown = {}) {
  return new Response(JSON.stringify({ SuccessResponse: { Head: head, Body: body } }), { status: 200 });
}

afterEach(() => vi.unstubAllGlobals());

describe("catálogo (lectores defensivos)", () => {
  it("lee marcas como objeto suelto o lista", () => {
    expect(leerMarcas({ Brands: { Brand: { Name: "Acme" } } })).toEqual([{ nombre: "Acme" }]);
    expect(leerMarcas({ Brands: { Brand: [{ Name: "A" }, { Name: " " }] } })).toEqual([{ nombre: "A" }]);
    expect(leerMarcas(null)).toEqual([]);
  });
  it("aplana el árbol y deja solo las hojas con su ruta", () => {
    const arbol = leerArbolCategorias({
      Categories: { Category: { CategoryId: 1, Name: "Hogar", Children: { Category: [{ CategoryId: 2, Name: "Cocina", Children: "" }] } } },
    });
    expect(aplanarHojas(arbol)).toEqual([{ id: 2, ruta: "Hogar › Cocina" }]);
  });
  it("lee atributos obligatorios y de variación", () => {
    const a = leerAtributos({ Attribute: [{ FeedName: "Color", IsMandatory: "1", GroupName: "Variation" }, { Name: "Modelo", IsMandatory: 0 }] });
    expect(a[0]).toMatchObject({ nombre: "Color", obligatorio: true, esVariacion: true });
    expect(a[1]).toMatchObject({ nombre: "Modelo", obligatorio: false });
  });
});

describe("publicar", () => {
  it("ProductCreate hace POST con XML y devuelve el FeedID", async () => {
    const f = vi.fn().mockResolvedValue(ok("", { RequestId: "abc-123-feed-id" }));
    vi.stubGlobal("fetch", f);
    await expect(enviarProductCreate(cred, borrador)).resolves.toBe("abc-123-feed-id");
    const [url, init] = f.mock.calls[0];
    expect(String(url)).toContain("Action=ProductCreate");
    expect(init.method).toBe("POST");
    expect(String(init.body)).toContain("<SellerSku>FULPun6322</SellerSku>");
  });

  it("no envía un borrador con problemas", async () => {
    const f = vi.fn();
    vi.stubGlobal("fetch", f);
    const malo = construirBorrador({ ...{ sku: "X", titulo: "", descripcion: "", modelo: "", precioOferta: 0, stock: 1, categoriaId: 0, imagenes: [] } });
    await expect(enviarProductCreate(cred, malo)).rejects.toBeInstanceOf(BorradorConProblemasError);
    expect(f).not.toHaveBeenCalled();
  });

  it("falla visible si Falabella acepta sin FeedID", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(ok("", {})));
    await expect(enviarImagenes(cred, "FULPun6322", ["https://x.com/1.jpg"])).rejects.toThrow(/FeedID/);
  });

  it("rechaza un FeedID raro antes de llamar", async () => {
    const f = vi.fn();
    vi.stubGlobal("fetch", f);
    await expect(consultarFeed(cred, "1&Action=Otra")).rejects.toThrow(/inválido/);
    expect(f).not.toHaveBeenCalled();
  });
});

describe("leerEstadoFeed", () => {
  it("Finished sin fallos = terminado", () => {
    expect(leerEstadoFeed("f", { FeedDetail: { Status: "Finished", TotalRecords: "1", ProcessedRecords: "1", FailedRecords: "0", FeedErrors: "" } }).estado).toBe("terminado");
  });
  it("Finished con fallos = con_errores, con el motivo", () => {
    const e = leerEstadoFeed("f", { FeedDetail: { Status: "Finished", FailedRecords: "1", FeedErrors: { Error: { Message: "Field Brand has a problem" } } } });
    expect(e.estado).toBe("con_errores");
    expect(e.errores).toEqual(["Field Brand has a problem"]);
  });
  it("forma inesperada = desconocido, nunca éxito", () => {
    expect(leerEstadoFeed("f", {}).estado).toBe("desconocido");
  });
});
