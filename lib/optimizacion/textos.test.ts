import { describe, expect, it } from "vitest";
import { leerCalidadItem, leerItemOptimizacion } from "@/lib/ml/cliente";
import {
  conversion,
  leerBusqueda,
  leerFiltroEstado,
  leerPagina,
  rotuloCompetencia,
  rotuloEstadoPublicacion,
  rotuloTipoPublicacion,
  tonoCalidad,
} from "@/lib/optimizacion/textos";

describe("filtros de la URL (lista blanca)", () => {
  it("estado, página y búsqueda", () => {
    expect(leerFiltroEstado("pausadas")).toBe("pausadas");
    expect(leerFiltroEstado("todas")).toBe("todas");
    expect(leerFiltroEstado("drop")).toBe("activas");
    expect(leerPagina("3")).toBe(3);
    expect(leerPagina("0")).toBe(1);
    expect(leerPagina("abc")).toBe(1);
    expect(leerBusqueda("  faja  ")).toBe("faja");
    expect(leerBusqueda("x".repeat(300))).toHaveLength(100);
  });
});

describe("cálculos y rótulos", () => {
  it("conversión = ventas / visitas, sin inventar un 0 %", () => {
    expect(conversion(3, 200)).toBe("1,5 %");
    expect(conversion(0, 50)).toBe("0,0 %");
    expect(conversion(1, 3)).toBe("33,3 %");
    expect(conversion(2, 0)).toBeNull();
    expect(conversion(null, 10)).toBeNull();
    expect(conversion(2, null)).toBeNull();
  });

  it("rótulos conocidos traducidos; los demás tal cual", () => {
    expect(rotuloTipoPublicacion("gold_pro")).toBe("Premium");
    expect(rotuloTipoPublicacion("gold_special")).toBe("Clásica");
    expect(rotuloTipoPublicacion("otro")).toBe("otro");
    expect(rotuloCompetencia("winning")).toEqual({ rotulo: "Ganando", tono: "exito" });
    expect(rotuloCompetencia("competing").rotulo).toBe("Compitiendo");
    expect(rotuloCompetencia("sharing_first_place").rotulo).toBe("Compartiendo");
    expect(rotuloCompetencia("listed")).toEqual({ rotulo: "listed", tono: "neutro" });
    expect(rotuloEstadoPublicacion("paused")).toBe("Pausada");
    expect(tonoCalidad(100)).toBe("exito");
    expect(tonoCalidad(60)).toBe("advertencia");
    expect(tonoCalidad(20)).toBe("peligro");
    expect(tonoCalidad(null)).toBe("neutro");
  });
});

describe("lectura de Mercado Libre (forma confirmada en staging, #457/#458)", () => {
  it("publicación del multiget: precio con y sin promoción, Full, envío gratis y SKU", () => {
    const item = leerItemOptimizacion({
      id: "MCO123456",
      title: "Faja",
      secure_thumbnail: "https://http2.mlstatic.com/foto.jpg",
      permalink: "https://articulo.mercadolibre.com.co/MCO-123456",
      status: "active",
      price: 80000,
      original_price: 100000,
      listing_type_id: "gold_pro",
      shipping: { free_shipping: true, logistic_type: "fulfillment" },
      catalog_listing: false,
      available_quantity: 7,
      attributes: [{ id: "SELLER_SKU", value_name: " FAJ-1 " }],
    });
    expect(item).toMatchObject({
      id: "MCO123456",
      precio: 80000,
      precioOriginal: 100000,
      tipoPublicacion: "gold_pro",
      envioGratis: true,
      full: true,
      catalogo: false,
      stock: 7,
      sku: "FAJ-1",
    });
  });

  it("la foto sale de thumbnail pasada a https (sin secure_thumbnail, que da 403 en lote)", () => {
    expect(leerItemOptimizacion({ id: "MCO1", thumbnail: "http://http2.mlstatic.com/D_1.jpg" })?.foto).toBe("https://http2.mlstatic.com/D_1.jpg");
    expect(leerItemOptimizacion({ id: "MCO1", thumbnail: "javascript:x" })?.foto).toBeNull();
  });

  it("sin promoción no hay precio original; un permalink raro no se usa", () => {
    const item = leerItemOptimizacion({ id: "MCO1", price: 50000, original_price: null, permalink: "javascript:alert(1)" });
    expect(item?.precioOriginal).toBeNull();
    expect(item?.enlace).toBeNull();
    expect(leerItemOptimizacion({ id: "no-es-id" })).toBeNull();
  });

  it("calidad: puntaje, nivel y objetivos sin completar", () => {
    const calidad = leerCalidadItem({
      score: 78,
      level: "good",
      level_wording: "Profesional",
      buckets: [
        {
          key: "USER_PRODUCT",
          variables: [
            { key: "UP_TITLE", status: "COMPLETED", title: "Mejora el título" },
            { key: "UP_PICTURES", status: "PENDING", title: "Agrega más fotos" },
          ],
        },
        { key: "OTRO", variables: [{ status: "PENDING", title: "  Completa la ficha técnica " }, { status: "PENDING" }] },
      ],
    });
    expect(calidad).toEqual({ puntaje: 78, nivel: "Profesional", pendientes: ["Agrega más fotos", "Completa la ficha técnica"] });
    expect(leerCalidadItem(null)).toEqual({ puntaje: null, nivel: null, pendientes: [] });
  });
});
