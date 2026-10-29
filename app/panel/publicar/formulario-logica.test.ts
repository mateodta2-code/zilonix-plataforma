import { describe, expect, it } from "vitest";
import type { ResultadoPublicacionCuenta } from "@/lib/ml/publicar-tipos";
import {
  construirEstadoInicial,
  construirEstadoInicialDesdeImportacion,
  cuentasFallidas,
  enlacesPermalink,
  esRellenoFalsoDimensiones,
  formatearFechaBogota,
  fotosDentroDelLimite,
  idItemDesdeLinkMl,
  itemImportadoDesdeMensajeExtension,
  moverFoto,
  parseImportacionBookmarklet,
  permalinkMlSeguro,
  productoCartesiano,
  resumenEstadoProducto,
  serializarCategoriaOverride,
  serializarClaveValor,
  type FilaProductoParaCargar,
} from "./formulario-logica";

describe("esRellenoFalsoDimensiones — ADENDO UX de Publicar, punto 9", () => {
  it("las 4 medidas en 1 (relleno falso): true", () => {
    expect(esRellenoFalsoDimensiones({ peso: "1", largo: "1", ancho: "1", alto: "1" })).toBe(true);
  });

  it("las 4 medidas por debajo de 1 (ej. 0.5): también true — nunca solo exactamente '1'", () => {
    expect(esRellenoFalsoDimensiones({ peso: "0.5", largo: "1", ancho: "0.8", alto: "0" })).toBe(true);
  });

  it("medidas reales (alguna > 1): false, nunca bloquea un paquete real", () => {
    expect(esRellenoFalsoDimensiones({ peso: "500", largo: "20", ancho: "15", alto: "10" })).toBe(false);
  });

  it("una sola medida en 1 pero las demás reales: false — no todas son <=1", () => {
    expect(esRellenoFalsoDimensiones({ peso: "500", largo: "1", ancho: "15", alto: "10" })).toBe(false);
  });

  it("alguna medida vacía (todavía sin completar): false — no se bloquea algo a medio llenar", () => {
    expect(esRellenoFalsoDimensiones({ peso: "1", largo: "1", ancho: "1", alto: "" })).toBe(false);
  });

  it("valor no numérico: false, nunca lanza", () => {
    expect(esRellenoFalsoDimensiones({ peso: "mucho", largo: "1", ancho: "1", alto: "1" })).toBe(false);
  });
});

describe("productoCartesiano — ADENDO UX de Publicar, punto 4 (editor de variantes)", () => {
  it("un solo eje: una combinación por valor", () => {
    expect(productoCartesiano({ TALLA: ["S", "M", "L"] }, ["TALLA"])).toEqual([{ TALLA: "S" }, { TALLA: "M" }, { TALLA: "L" }]);
  });

  it("dos ejes: el producto cartesiano completo, en orden", () => {
    const resultado = productoCartesiano({ TALLA: ["S", "M"], COLOR: ["Rojo", "Azul"] }, ["TALLA", "COLOR"]);
    expect(resultado).toEqual([
      { TALLA: "S", COLOR: "Rojo" },
      { TALLA: "S", COLOR: "Azul" },
      { TALLA: "M", COLOR: "Rojo" },
      { TALLA: "M", COLOR: "Azul" },
    ]);
  });

  it("un eje sin ningún valor elegido todavía: sin combinaciones (nunca inventa una vacía)", () => {
    expect(productoCartesiano({ TALLA: [] }, ["TALLA"])).toEqual([]);
  });

  it("sin ejes: sin combinaciones", () => {
    expect(productoCartesiano({}, [])).toEqual([]);
  });
});

describe("serializarClaveValor — mismo formato que parsearLineasClaveValor (nuevo/actions.ts) ya lee", () => {
  it("arma 'ID=valor' por línea", () => {
    expect(serializarClaveValor({ BRAND: "Genérica", GTIN: "7701234567890" })).toBe("BRAND=Genérica\nGTIN=7701234567890");
  });

  it("omite valores vacíos (el parser los ignora igual, nunca manda una línea basura)", () => {
    expect(serializarClaveValor({ BRAND: "Genérica", GENDER: "" })).toBe("BRAND=Genérica");
  });

  it("sin nada lleno: string vacío", () => {
    expect(serializarClaveValor({})).toBe("");
  });
});

describe("serializarCategoriaOverride — mismo formato 'siteId::título=categoryId' que ya lee nuevo/actions.ts", () => {
  it("arma la clave real", () => {
    expect(serializarCategoriaOverride("MCO", "Reloj Casio Digital", "MCO1234")).toBe("MCO::Reloj Casio Digital=MCO1234");
  });

  it("sin título o sin categoría: string vacío, nunca una clave a medias", () => {
    expect(serializarCategoriaOverride("MCO", "", "MCO1234")).toBe("");
    expect(serializarCategoriaOverride("MCO", "Reloj", "")).toBe("");
  });
});

describe("fotosDentroDelLimite — ADENDO UX de Publicar, punto 5 (respetar max_pictures)", () => {
  it("recorta al límite real de la categoría", () => {
    expect(fotosDentroDelLimite(["a", "b", "c", "d"], 2)).toEqual(["a", "b"]);
  });

  it("sin límite conocido todavía (null): no recorta nada", () => {
    expect(fotosDentroDelLimite(["a", "b", "c"], null)).toEqual(["a", "b", "c"]);
  });

  it("menos fotos que el límite: se quedan todas", () => {
    expect(fotosDentroDelLimite(["a"], 12)).toEqual(["a"]);
  });
});

// --- Parte 2 (página única, estructura de Zilonix OS) ---

function exito(cuentaMlId: string): ResultadoPublicacionCuenta {
  return {
    cuentaMlId,
    ok: true,
    itemId: "MCOITEM1",
    permalink: "https://articulo.mercadolibre.com.co/MCOITEM1",
    categoria: "Relojes",
    atributosAsumidos: [],
    status: "active",
    modoPrueba: false,
    avisoFotosVariante: null,
    avisoMarca: null,
    avisoDescripcion: null,
  };
}

function fallo(cuentaMlId: string, error = "Mercado Libre rechazó la publicación."): ResultadoPublicacionCuenta {
  return { cuentaMlId, ok: false, categoria: "Relojes", error };
}

describe("resumenEstadoProducto — punto 8 del pedido (✅/⚠️/❌ ok/total)", () => {
  it("todas OK: ✅", () => {
    expect(resumenEstadoProducto([exito("c1"), exito("c2")])).toEqual({ ok: 2, total: 2, icono: "✅" });
  });

  it("parcial (algunas OK, algunas no): ⚠️", () => {
    expect(resumenEstadoProducto([exito("c1"), fallo("c2")])).toEqual({ ok: 1, total: 2, icono: "⚠️" });
  });

  it("ninguna OK: ❌", () => {
    expect(resumenEstadoProducto([fallo("c1"), fallo("c2")])).toEqual({ ok: 0, total: 2, icono: "❌" });
  });

  it("sin resultado todavía (null) o vacío: null — nunca inventa un ícono para 'Publicando…'", () => {
    expect(resumenEstadoProducto(null)).toBeNull();
    expect(resumenEstadoProducto(undefined)).toBeNull();
    expect(resumenEstadoProducto([])).toBeNull();
  });

  it("también cuenta un resultado de familia (User Products) por su propio ok/cuentaMlId", () => {
    const familia: ResultadoPublicacionCuenta = { cuentaMlId: "c1", ok: true, categoria: "Ropa interior", familia: { familyName: "Combo X", items: [] } };
    expect(resumenEstadoProducto([familia, fallo("c2")])).toEqual({ ok: 1, total: 2, icono: "⚠️" });
  });
});

describe("cuentasFallidas — punto 8 del pedido (Cargar/Reintentar: solo las que fallaron)", () => {
  it("devuelve solo los cuentaMlId con ok:false", () => {
    expect(cuentasFallidas([exito("c1"), fallo("c2"), fallo("c3")])).toEqual(["c2", "c3"]);
  });

  it("todas OK: []", () => {
    expect(cuentasFallidas([exito("c1"), exito("c2")])).toEqual([]);
  });

  it("sin resultado (null/undefined): []", () => {
    expect(cuentasFallidas(null)).toEqual([]);
    expect(cuentasFallidas(undefined)).toEqual([]);
  });
});

function productoBase(overrides: Partial<FilaProductoParaCargar> = {}): FilaProductoParaCargar {
  return {
    precio: "79900",
    stock: 10,
    condicion: "new",
    envioGratis: true,
    sku: "SKU-1",
    dimensiones: { peso: "300", largo: "20", ancho: "15", alto: "10" },
    imagenes: [{ url: "https://x/1.jpg" }, { url: "https://x/2.jpg" }],
    atributosExtra: { BRAND: "Genérica" },
    categoriasOverride: { "MCO::Reloj Casio Digital": "MCO1234" },
    variantes: null,
    porCuenta: { c1: { titulo: "Reloj Casio Digital", descripcion: "Descripción real", portadaUrl: "https://x/portada.jpg" } },
    cuentasSeleccionadas: ["c1", "c2"],
    resultado: null,
    modoPrueba: true,
    ...overrides,
  };
}

describe("construirEstadoInicial — punto 8 del pedido (Cargar/Reintentar y Duplicar)", () => {
  it("reintentar, con resultado parcial: solo las cuentas que fallaron quedan incluidas", () => {
    const producto = productoBase({ resultado: [exito("c1"), fallo("c2")] });
    const estado = construirEstadoInicial(producto, "reintentar");
    expect(estado.cuentasIncluidas).toEqual(["c2"]);
  });

  it("reintentar, sin resultado todavía (nunca llegó a publicar): cae a cuentasSeleccionadas", () => {
    const producto = productoBase({ resultado: null });
    const estado = construirEstadoInicial(producto, "reintentar");
    expect(estado.cuentasIncluidas).toEqual(["c1", "c2"]);
  });

  it("duplicar: SIEMPRE cuentas desmarcadas, sin importar el resultado anterior", () => {
    const producto = productoBase({ resultado: [exito("c1"), fallo("c2")] });
    const estado = construirEstadoInicial(producto, "duplicar");
    expect(estado.cuentasIncluidas).toEqual([]);
  });

  it("copia precio/stock/condición/envío/SKU/dimensiones/fotos/atributos/categoría/modo prueba tal cual, en los dos modos", () => {
    const producto = productoBase();
    for (const modo of ["reintentar", "duplicar"] as const) {
      const estado = construirEstadoInicial(producto, modo);
      expect(estado.precio).toBe("79900");
      expect(estado.stock).toBe("10");
      expect(estado.condicion).toBe("new");
      expect(estado.envioGratis).toBe(true);
      expect(estado.sku).toBe("SKU-1");
      expect(estado.dimensiones).toEqual({ peso: "300", largo: "20", ancho: "15", alto: "10" });
      expect(estado.imagenes).toEqual(["https://x/1.jpg", "https://x/2.jpg"]);
      expect(estado.atributosExtra).toEqual({ BRAND: "Genérica" });
      expect(estado.categoriasOverride).toEqual({ "MCO::Reloj Casio Digital": "MCO1234" });
      expect(estado.modoPrueba).toBe(true);
      expect(estado.datosPorCuenta.c1).toEqual({ titulo: "Reloj Casio Digital", descripcion: "Descripción real", portadaUrl: "https://x/portada.jpg" });
    }
  });

  it("variantes: convierte sku/stock/precio numéricos de la fila a texto para los inputs controlados", () => {
    const producto = productoBase({
      variantes: { ejes: ["TALLA"], ejeFoto: null, combinaciones: [{ valores: { TALLA: "S" }, sku: "SKU-S", stock: 5, precio: 50000 }] },
    });
    const estado = construirEstadoInicial(producto, "reintentar");
    expect(estado.variantes).toEqual({
      ejes: ["TALLA"],
      ejeFoto: null,
      combinaciones: [{ valores: { TALLA: "S" }, sku: "SKU-S", stock: "5", precio: "50000" }],
    });
  });

  it("sin variantes (null o sin combinaciones): variantes queda null", () => {
    expect(construirEstadoInicial(productoBase({ variantes: null }), "reintentar").variantes).toBeNull();
    expect(construirEstadoInicial(productoBase({ variantes: { ejes: [], ejeFoto: null, combinaciones: [] } }), "reintentar").variantes).toBeNull();
  });

  it("portadasPorVariante: toma el primer mapeo no vacío entre las cuentas (se guarda igual en todas)", () => {
    const producto = productoBase({
      porCuenta: {
        c1: { titulo: "T", descripcion: "", portadaUrl: null, portadasPorVariante: {} },
        c2: { titulo: "T", descripcion: "", portadaUrl: null, portadasPorVariante: { S: "https://x/s.jpg" } },
      },
    });
    const estado = construirEstadoInicial(producto, "reintentar");
    expect(estado.portadasPorVariante).toEqual({ S: "https://x/s.jpg" });
  });
});

describe("formatearFechaBogota — punto 8 del pedido (Fecha en America/Bogota, sin importar el TZ del servidor)", () => {
  it("formatea una fecha real en la zona de Bogotá (UTC-5 fijo, sin horario de verano)", () => {
    // 2026-01-15T03:30:00Z = 2026-01-14 22:30 en Bogotá (UTC-5).
    const texto = formatearFechaBogota(new Date("2026-01-15T03:30:00Z"));
    expect(texto).toContain("14/01/2026");
  });

  it("acepta un string ISO (tal cual sale de una columna timestamp serializada)", () => {
    const texto = formatearFechaBogota("2026-06-01T12:00:00Z");
    expect(texto).toContain("2026");
  });
});

describe("moverFoto — punto 4 del pedido (reordenar la galería arrastrando)", () => {
  it("mueve una foto de atrás hacia adelante", () => {
    expect(moverFoto(["a", "b", "c"], 2, 0)).toEqual(["c", "a", "b"]);
  });

  it("mueve una foto de adelante hacia atrás", () => {
    expect(moverFoto(["a", "b", "c"], 0, 2)).toEqual(["b", "c", "a"]);
  });

  it("mismo índice: no cambia nada", () => {
    expect(moverFoto(["a", "b", "c"], 1, 1)).toEqual(["a", "b", "c"]);
  });

  it("índices fuera de rango: devuelve el array tal cual, nunca lanza", () => {
    expect(moverFoto(["a", "b"], -1, 0)).toEqual(["a", "b"]);
    expect(moverFoto(["a", "b"], 0, 5)).toEqual(["a", "b"]);
  });
});

describe("enlacesPermalink — Parte 3, punto B (permalink en el historial)", () => {
  const cuentas = [
    { id: "c1", nickname: "Tienda Uno" },
    { id: "c2", nickname: "Tienda Dos" },
  ];

  it("sin resultado todavía: []", () => {
    expect(enlacesPermalink(null, cuentas)).toEqual([]);
    expect(enlacesPermalink(undefined, cuentas)).toEqual([]);
  });

  it("éxito clásico: un enlace con el nickname real de la cuenta", () => {
    const resultado: ResultadoPublicacionCuenta[] = [
      {
        cuentaMlId: "c1",
        ok: true,
        itemId: "MCO1",
        permalink: "https://articulo.mercadolibre.com.co/MCO-1",
        categoria: "MCO123",
        atributosAsumidos: [],
        status: "active",
        modoPrueba: false,
        avisoFotosVariante: null,
        avisoMarca: null,
        avisoDescripcion: null,
      },
    ];
    expect(enlacesPermalink(resultado, cuentas)).toEqual([{ cuentaMlId: "c1", etiqueta: "Tienda Uno", permalink: "https://articulo.mercadolibre.com.co/MCO-1" }]);
  });

  it("fallo (ok:false): nunca aparece, nunca un link roto", () => {
    const resultado: ResultadoPublicacionCuenta[] = [{ cuentaMlId: "c1", ok: false, error: "Mercado Libre rechazó la publicación" }];
    expect(enlacesPermalink(resultado, cuentas)).toEqual([]);
  });

  it("familia (User Products): un enlace por cada ítem OK con permalink, con el sufijo del SKU o los valores", () => {
    const resultado: ResultadoPublicacionCuenta[] = [
      {
        cuentaMlId: "c2",
        ok: true,
        familia: {
          familyName: "Remera",
          items: [
            { valores: { TALLA: "S" }, sku: "REM-S", ok: true, itemId: "MCO2", permalink: "https://articulo.mercadolibre.com.co/MCO-2" },
            { valores: { TALLA: "M" }, ok: false, error: "rechazado" },
          ],
        },
      },
    ];
    expect(enlacesPermalink(resultado, cuentas)).toEqual([{ cuentaMlId: "c2", etiqueta: "Tienda Dos (REM-S)", permalink: "https://articulo.mercadolibre.com.co/MCO-2" }]);
  });

  it("cuentaMlId sin match en la lista de cuentas (ej. ya desconectada): usa el id crudo como etiqueta, nunca lanza", () => {
    const resultado: ResultadoPublicacionCuenta[] = [
      {
        cuentaMlId: "c-desconocida",
        ok: true,
        itemId: "MCO1",
        permalink: "https://articulo.mercadolibre.com.co/MCO-1",
        categoria: "MCO123",
        atributosAsumidos: [],
        status: "active",
        modoPrueba: false,
        avisoFotosVariante: null,
        avisoMarca: null,
        avisoDescripcion: null,
      },
    ];
    expect(enlacesPermalink(resultado, cuentas)).toEqual([{ cuentaMlId: "c-desconocida", etiqueta: "c-desconocida", permalink: "https://articulo.mercadolibre.com.co/MCO-1" }]);
  });

  // Feedback real de Mateo (staging): publicó 1/1 OK y el historial no
  // mostraba ningún link. Causa confirmada: lib/ml/publicar.ts guarda
  // el permalink tal cual lo devuelve POST /items, que a veces viene
  // en http:// (ese mismo ítem, consultado después por GET /items/{id},
  // ya lo da en https:// — comportamiento real de esa API). Normaliza,
  // nunca lo descarta.
  it("permalink http:// de Mercado Libre: se normaliza a https, nunca se omite", () => {
    const resultado: ResultadoPublicacionCuenta[] = [
      {
        cuentaMlId: "c1",
        ok: true,
        itemId: "MCO1",
        permalink: "http://articulo.mercadolibre.com.co/MCO-1",
        categoria: "MCO123",
        atributosAsumidos: [],
        status: "active",
        modoPrueba: false,
        avisoFotosVariante: null,
        avisoMarca: null,
        avisoDescripcion: null,
      },
    ];
    expect(enlacesPermalink(resultado, cuentas)).toEqual([{ cuentaMlId: "c1", etiqueta: "Tienda Uno", permalink: "https://articulo.mercadolibre.com.co/MCO-1" }]);
  });

  // Mismo feedback — a veces el resultado ni siquiera trae permalink
  // (el tipo lo permite para la familia; una fila vieja tampoco lo
  // tendría). Con el itemId real ya confirmado por ML se arma el link
  // oficial (mismo formato que linkPublicacion, lib/ml/cliente.ts).
  it("sin permalink pero con itemId real: arma el link oficial desde el itemId", () => {
    const resultado: ResultadoPublicacionCuenta[] = [
      {
        cuentaMlId: "c1",
        ok: true,
        itemId: "MCO1234567890",
        permalink: "",
        categoria: "MCO123",
        atributosAsumidos: [],
        status: "active",
        modoPrueba: true,
        avisoFotosVariante: null,
        avisoMarca: null,
        avisoDescripcion: null,
      },
    ];
    expect(enlacesPermalink(resultado, cuentas)).toEqual([{ cuentaMlId: "c1", etiqueta: "Tienda Uno", permalink: "https://articulo.mercadolibre.com.co/MCO-1234567890" }]);
  });

  it("permalink inválido (javascript:) pero con itemId real: igual arma el link oficial desde el itemId, nunca se queda sin nada", () => {
    const resultado: ResultadoPublicacionCuenta[] = [
      {
        cuentaMlId: "c2",
        ok: true,
        familia: {
          familyName: "Remera",
          items: [{ valores: { TALLA: "S" }, sku: "REM-S", ok: true, itemId: "MCO2", permalink: "javascript:alert(1)" }],
        },
      },
    ];
    expect(enlacesPermalink(resultado, cuentas)).toEqual([{ cuentaMlId: "c2", etiqueta: "Tienda Dos (REM-S)", permalink: "https://articulo.mercadolibre.com.co/MCO-2" }]);
  });

  it("ni permalink útil ni itemId: se omite, nunca un link roto", () => {
    const resultado: ResultadoPublicacionCuenta[] = [{ cuentaMlId: "c1", ok: true, familia: { familyName: "Remera", items: [{ valores: { TALLA: "S" }, ok: true }] } }];
    expect(enlacesPermalink(resultado, cuentas)).toEqual([]);
  });

  // Dominio ajeno SIN ningún itemId con el que armar un respaldo
  // seguro — así se confirma el rechazo del host en sí, aislado del
  // fallback por itemId (que ya se prueba arriba).
  it("revisión de seguridad — permalink de un dominio ajeno y sin itemId: se omite, nunca un link inseguro", () => {
    const resultado: ResultadoPublicacionCuenta[] = [
      { cuentaMlId: "c1", ok: true, familia: { familyName: "Remera", items: [{ valores: { TALLA: "S" }, ok: true, permalink: "https://evil.com/MCO-1" }] } },
    ];
    expect(enlacesPermalink(resultado, cuentas)).toEqual([]);
  });

  it("revisión de seguridad — permalink javascript:/data: disfrazado Y sin itemId: se omite, nunca llega a <a href>", () => {
    const resultado: ResultadoPublicacionCuenta[] = [
      { cuentaMlId: "c2", ok: true, familia: { familyName: "Remera", items: [{ valores: { TALLA: "S" }, sku: "REM-S", ok: true, permalink: "javascript:alert(1)" }] } },
    ];
    expect(enlacesPermalink(resultado, cuentas)).toEqual([]);
  });
});

describe("permalinkMlSeguro — revisión de seguridad (hallazgo MED): solo https + Mercado Libre", () => {
  it("acepta un permalink real de Mercado Libre (https, cualquier país)", () => {
    expect(permalinkMlSeguro("https://articulo.mercadolibre.com.co/MCO-1234567890-algo")).toBe("https://articulo.mercadolibre.com.co/MCO-1234567890-algo");
    expect(permalinkMlSeguro("https://articulo.mercadolibre.com.ar/MLA-1")).toBe("https://articulo.mercadolibre.com.ar/MLA-1");
  });

  it("rechaza javascript:/data: disfrazado de URL", () => {
    expect(permalinkMlSeguro("javascript:alert(1)")).toBeNull();
    expect(permalinkMlSeguro("data:text/html,<script>alert(1)</script>")).toBeNull();
  });

  // Feedback real de Mateo (staging): POST /items de Mercado Libre a
  // veces devuelve el permalink en http:// — se normaliza a https
  // cuando el HOST ya es de Mercado Libre, nunca se descarta un link
  // real por eso.
  it("normaliza http:// a https:// cuando el host SÍ es de Mercado Libre", () => {
    expect(permalinkMlSeguro("http://articulo.mercadolibre.com.co/MCO-1")).toBe("https://articulo.mercadolibre.com.co/MCO-1");
    expect(permalinkMlSeguro("http://articulo.mercadolibre.com.ar/MLA-1")).toBe("https://articulo.mercadolibre.com.ar/MLA-1");
  });

  it("rechaza un dominio ajeno (nunca Mercado Libre), incluso uno que solo CONTIENE el nombre real — en http O https", () => {
    expect(permalinkMlSeguro("https://evil.com")).toBeNull();
    expect(permalinkMlSeguro("http://evil.com")).toBeNull();
    expect(permalinkMlSeguro("https://mercadolibre.com.ataque.com/MCO-1")).toBeNull();
    expect(permalinkMlSeguro("http://mercadolibre.com.ataque.com/MCO-1")).toBeNull();
  });

  it("rechaza otros protocolos distintos de http/https (ftp:, etc.)", () => {
    expect(permalinkMlSeguro("ftp://articulo.mercadolibre.com.co/MCO-1")).toBeNull();
  });

  it("texto que no es una URL: null, nunca lanza", () => {
    expect(permalinkMlSeguro("no es un link")).toBeNull();
    expect(permalinkMlSeguro("")).toBeNull();
  });
});

describe("idItemDesdeLinkMl — Parte 3, punto A.2 (importar por link)", () => {
  it("link clásico de publicación (/MCO-1234567890-slug): el id sin el guion", () => {
    expect(idItemDesdeLinkMl("https://articulo.mercadolibre.com.co/MCO-1234567890-algo-_JM")).toBe("MCO1234567890");
  });

  it("link de catálogo (/p/MCO...): el id de producto", () => {
    expect(idItemDesdeLinkMl("https://www.mercadolibre.com.co/producto-x/p/MCO12345678")).toBe("MCO12345678");
  });

  it("id real dentro de un query param (wid=): prioridad sobre el path", () => {
    expect(idItemDesdeLinkMl("https://articulo.mercadolibre.com.co/MCO-999-slug?wid=MCO1111111111")).toBe("MCO1111111111");
  });

  it("texto que no es una URL: null, nunca lanza", () => {
    expect(idItemDesdeLinkMl("no es un link")).toBeNull();
  });

  it("URL de otro sitio (nunca Mercado Libre): null — nunca se llama a la API con un id ajeno a esto", () => {
    expect(idItemDesdeLinkMl("https://www.ejemplo.com/MCO-123")).toBeNull();
  });

  it("vacío: null", () => {
    expect(idItemDesdeLinkMl("")).toBeNull();
    expect(idItemDesdeLinkMl("   ")).toBeNull();
  });
});

describe("parseImportacionBookmarklet — Parte 3, punto A.3 (pegar el JSON del bookmarklet)", () => {
  it("JSON válido con galería: arma el ItemImportado completo", () => {
    const json = JSON.stringify({
      titulo: "Producto de prueba",
      descripcion: "Una descripción",
      precio: 25000,
      dimensiones: { peso: "300", largo: "20", ancho: "15", alto: "10" },
      galeria: [
        { id: "bk-0", url: "https://http2.mlstatic.com/foo-O.jpg" },
        { id: "bk-1", url: "https://http2.mlstatic.com/bar-O.jpg" },
      ],
    });
    expect(parseImportacionBookmarklet(json)).toEqual({
      titulo: "Producto de prueba",
      descripcion: "Una descripción",
      precio: "25000",
      stock: "",
      sku: "",
      imagenes: ["https://http2.mlstatic.com/foo-O.jpg", "https://http2.mlstatic.com/bar-O.jpg"],
      dimensiones: { peso: "300", largo: "20", ancho: "15", alto: "10" },
    });
  });

  it("JSON inválido (la persona pegó cualquier otra cosa): null, nunca lanza", () => {
    expect(parseImportacionBookmarklet("esto no es JSON")).toBeNull();
    expect(parseImportacionBookmarklet("")).toBeNull();
  });

  it("JSON válido pero sin la forma esperada (ej. un array suelto): null", () => {
    expect(parseImportacionBookmarklet("[1,2,3]")).toBeNull();
  });

  it("campos faltantes (ej. sin precio ni galería): valores vacíos, nunca lanza", () => {
    expect(parseImportacionBookmarklet(JSON.stringify({ titulo: "X" }))).toEqual({
      titulo: "X",
      descripcion: "",
      precio: "",
      stock: "",
      sku: "",
      imagenes: [],
      dimensiones: { peso: "", largo: "", ancho: "", alto: "" },
    });
  });

  it("revisión de seguridad — filtra fotos que NO son https reales (javascript:/data: disfrazado), mismo criterio que la extensión", () => {
    const json = JSON.stringify({
      titulo: "X",
      galeria: [
        { id: "bk-0", url: "https://http2.mlstatic.com/foo-O.jpg" },
        { id: "bk-1", url: "javascript:alert(1)" },
        { id: "bk-2", url: "data:text/html,<script>alert(1)</script>" },
        { id: "bk-3", url: "http://sin-https.com/foo.jpg" },
      ],
    });
    expect(parseImportacionBookmarklet(json)?.imagenes).toEqual(["https://http2.mlstatic.com/foo-O.jpg"]);
  });

  it("revisión de seguridad — sin título/descripción/precio y sin ninguna foto https real: null (nunca hidrata el formulario con nada)", () => {
    expect(parseImportacionBookmarklet(JSON.stringify({}))).toBeNull();
    expect(parseImportacionBookmarklet(JSON.stringify({ galeria: [{ id: "bk-0", url: "javascript:alert(1)" }] }))).toBeNull();
  });
});

describe("itemImportadoDesdeMensajeExtension — Parte 3, punto D (postMessage de 'Importar a Publicar', nunca confiado ciegamente)", () => {
  it("mensaje válido completo: arma el ItemImportado", () => {
    expect(
      itemImportadoDesdeMensajeExtension({
        titulo: "Producto de Mercado Libre",
        descripcion: "Descripción real",
        precio: 50000,
        imagenes: ["https://http2.mlstatic.com/foo-O.jpg", "https://http2.mlstatic.com/bar-O.jpg"],
      })
    ).toEqual({
      titulo: "Producto de Mercado Libre",
      descripcion: "Descripción real",
      precio: "50000",
      stock: "",
      sku: "",
      imagenes: ["https://http2.mlstatic.com/foo-O.jpg", "https://http2.mlstatic.com/bar-O.jpg"],
      dimensiones: {},
    });
  });

  it("filtra imágenes que NO son http(s) reales (ej. javascript:/data: disfrazado) — nunca confía en lo que mande la página", () => {
    const r = itemImportadoDesdeMensajeExtension({
      titulo: "X",
      imagenes: ["https://http2.mlstatic.com/foo.jpg", "javascript:alert(1)", "data:text/html,<script>", "http://sin-https.com/foo.jpg", 123],
    });
    expect(r?.imagenes).toEqual(["https://http2.mlstatic.com/foo.jpg"]);
  });

  it("precio no numérico, cero o negativo: cadena vacía, nunca NaN ni un precio inválido", () => {
    expect(itemImportadoDesdeMensajeExtension({ titulo: "X", precio: "50000" })?.precio).toBe("");
    expect(itemImportadoDesdeMensajeExtension({ titulo: "X", precio: 0 })?.precio).toBe("");
    expect(itemImportadoDesdeMensajeExtension({ titulo: "X", precio: -100 })?.precio).toBe("");
    expect(itemImportadoDesdeMensajeExtension({ titulo: "X", precio: NaN })?.precio).toBe("");
  });

  it("título recortado a 60 caracteres (mismo tope que el prefill de Investigación)", () => {
    const tituloLargo = "X".repeat(100);
    expect(itemImportadoDesdeMensajeExtension({ titulo: tituloLargo })?.titulo.length).toBe(60);
  });

  it("no es un objeto (string/número/array/null): null, nunca lanza", () => {
    expect(itemImportadoDesdeMensajeExtension("texto")).toBeNull();
    expect(itemImportadoDesdeMensajeExtension(123)).toBeNull();
    expect(itemImportadoDesdeMensajeExtension([1, 2, 3])).toBeNull();
    expect(itemImportadoDesdeMensajeExtension(null)).toBeNull();
    expect(itemImportadoDesdeMensajeExtension(undefined)).toBeNull();
  });

  it("objeto vacío o sin ningún campo reconocible: null — nunca hidrata el formulario con nada", () => {
    expect(itemImportadoDesdeMensajeExtension({})).toBeNull();
    expect(itemImportadoDesdeMensajeExtension({ otraCosa: true })).toBeNull();
  });
});

describe("construirEstadoInicialDesdeImportacion — Parte 3, punto A (precargar el formulario sin publicar)", () => {
  const item = {
    titulo: "Importado",
    descripcion: "Desc importada",
    precio: "15000",
    stock: "5",
    sku: "SKU-1",
    imagenes: ["https://a.jpg", "https://b.jpg"],
    dimensiones: { peso: "300" },
  };

  it("copia título/descripción/portada (primera foto) a TODAS las cuentas recibidas", () => {
    const estado = construirEstadoInicialDesdeImportacion(["c1", "c2"], item);
    expect(estado.datosPorCuenta).toEqual({
      c1: { titulo: "Importado", descripcion: "Desc importada", portadaUrl: "https://a.jpg" },
      c2: { titulo: "Importado", descripcion: "Desc importada", portadaUrl: "https://a.jpg" },
    });
  });

  it("cuentasIncluidas queda vacío a propósito (la persona elige a cuáles publicar)", () => {
    expect(construirEstadoInicialDesdeImportacion(["c1"], item).cuentasIncluidas).toEqual([]);
  });

  it("precio/stock/sku/imágenes/dimensiones vienen del item importado", () => {
    const estado = construirEstadoInicialDesdeImportacion(["c1"], item);
    expect(estado.precio).toBe("15000");
    expect(estado.stock).toBe("5");
    expect(estado.sku).toBe("SKU-1");
    expect(estado.imagenes).toEqual(["https://a.jpg", "https://b.jpg"]);
    expect(estado.dimensiones).toEqual({ peso: "300", largo: "", ancho: "", alto: "" });
  });

  it("sin stock en el item importado: cae a '1' (mismo valor por defecto que un producto nuevo)", () => {
    expect(construirEstadoInicialDesdeImportacion(["c1"], { ...item, stock: "" }).stock).toBe("1");
  });

  it("sin ninguna foto: portadaUrl vacía, nunca undefined", () => {
    const estado = construirEstadoInicialDesdeImportacion(["c1"], { ...item, imagenes: [] });
    expect(estado.datosPorCuenta.c1.portadaUrl).toBe("");
  });

  it("sin ninguna cuenta: datosPorCuenta vacío, nunca lanza", () => {
    expect(construirEstadoInicialDesdeImportacion([], item).datosPorCuenta).toEqual({});
  });
});
