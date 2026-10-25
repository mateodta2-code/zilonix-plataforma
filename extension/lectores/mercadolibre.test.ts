import { describe, expect, it } from "vitest";
// extension/lectores/mercadolibre.js es JS plano (corre como content
// script de la extensión) pero exporta estas funciones con
// `module.exports` cuando `module` existe (mismo patrón que
// extension/seguridad.js) — alcanza para probarlas con un HTML de
// ejemplo, sin navegador ni DOM real.
import {
  calcularVentasPromedioMes,
  construirLinkSeguirProducto,
  construirLinkSeguirTienda,
  extraerCustIdDeUrl,
  extraerIdDeUrl,
  leerDatosIncrustados,
  leerSellerIdDeTienda,
  tipoDePagina,
} from "./mercadolibre.js";

// Issue #192 — bug real: una tienda oficial real de Mercado Libre.
const LINK_TIENDA_OFICIAL_SIN_SELLER =
  "https://www.mercadolibre.com.co/tienda/colchones-relax?item_id=MCO1657640131&category_id=MCO1574&official_store_id=53573&client=recoview-selleritems&recos_listing=true";

// URL_APP real de extension/config.js (producción) — se repite el
// literal acá a propósito: si alguien cambia config.js sin querer,
// esta prueba lo nota.
const URL_APP = "https://web-production-af270.up.railway.app";

// Issue #174, corrección real: la página de UN producto trae en el
// mismo JSON los datos de OTROS productos (recomendados). Este HTML
// de ejemplo tiene DOS productos — el actual (MCO111111111) y uno
// recomendado (MCO222222222) con un sold_quantity bien distinto — para
// confirmar que leerDatosIncrustados() agarra el del producto correcto
// según el id que viene de la URL, nunca "el primer sold_quantity que
// encuentre". La fecha de "title" con llaves/comillas adentro sigue
// probando que el extractor de JSON balanceado no corta el objeto a
// mitad de camino.
const HTML_DOS_PRODUCTOS = `<!doctype html><html><head></head><body>
<script>window.__PRELOADED_STATE__ = {"otraCosa": true};</script>
<script>
window.__NORDIC_RENDERING_CTX__ = {"page":{"components":{
  "item":{"id":"MCO111111111","sold_quantity":537,"date_created":"2023-05-10T14:23:00.000Z","title":"Reloj con \\"comillas\\" y { llaves } adentro"},
  "recomendados":[{"id":"MCO222222222","sold_quantity":9999,"date_created":"2020-01-01T00:00:00.000Z"}]
}}};
</script>
</body></html>`;

// Mismos dos productos, pero SIN __NORDIC_RENDERING_CTX__ — simula que
// Mercado Libre cambió el nombre de la variable o la movió: el
// respaldo de texto plano tiene que agarrar el sold_quantity que está
// CERCA del id correcto (separados por bastante relleno, a propósito,
// para que agarrar "el primero que aparezca en el HTML" sin amarre
// hubiera dado el resultado equivocado).
const RELLENO_LARGO = "<!-- relleno -->".repeat(60); // bien más de 500 caracteres
const HTML_TEXTO_DOS_PRODUCTOS = `<!doctype html><html><body>
<script>window.__OTRA_VARIABLE_FUTURA__ = {"recomendado":{"id":"MCO222222222","sold_quantity":9999,"date_created":"2020-01-01T00:00:00.000Z"}};</script>
${RELLENO_LARGO}
<script>window.__OTRA_MAS__ = {"item":{"id":"MCO111111111","sold_quantity":50,"date_created":"2024-01-01T00:00:00.000Z"}};</script>
</body></html>`;

const HTML_SIN_NADA = `<!doctype html><html><body><p>Página sin ningún dato incrustado</p></body></html>`;

describe("extraerIdDeUrl — issue #174, el producto actual lo manda la URL, nunca el HTML", () => {
  it("MCO-123456789 (con guión, como en la URL real) -> MCO123456789", () => {
    expect(extraerIdDeUrl("https://articulo.mercadolibre.com.co/MCO-123456789-reloj-digital-_JM")).toBe("MCO123456789");
  });

  it("MCO123456789 (sin guión) también funciona", () => {
    expect(extraerIdDeUrl("https://www.mercadolibre.com.co/p/MCO123456789")).toBe("MCO123456789");
  });

  it("una URL sin ningún id de Mercado Libre -> null", () => {
    expect(extraerIdDeUrl("https://www.mercadolibre.com.co/ofertas")).toBeNull();
    expect(extraerIdDeUrl(null)).toBeNull();
  });
});

describe("leerDatosIncrustados — issue #174, amarrado al producto actual (nunca el de otro producto de la misma página)", () => {
  it("con dos productos en el JSON incrustado, agarra el sold_quantity/date_created del que coincide con el id actual", () => {
    expect(leerDatosIncrustados(HTML_DOS_PRODUCTOS, "MCO111111111")).toEqual({
      soldQuantity: 537,
      itemId: "MCO111111111",
      dateCreated: "2023-05-10T14:23:00.000Z",
    });
  });

  it("pidiendo el OTRO id de la misma página, trae los datos del otro producto — confirma que de verdad distingue cuál es cuál", () => {
    expect(leerDatosIncrustados(HTML_DOS_PRODUCTOS, "MCO222222222")).toEqual({
      soldQuantity: 9999,
      itemId: "MCO222222222",
      dateCreated: "2020-01-01T00:00:00.000Z",
    });
  });

  it("si el id actual no aparece en ningún lado del JSON, nunca devuelve el de otro producto — todo null", () => {
    expect(leerDatosIncrustados(HTML_DOS_PRODUCTOS, "MCO333333333")).toEqual({ soldQuantity: null, itemId: null, dateCreated: null });
  });

  it("respaldo de texto plano (sin __NORDIC_RENDERING_CTX__): agarra el sold_quantity cercano al id correcto, no el de otro producto más lejos en el HTML", () => {
    expect(leerDatosIncrustados(HTML_TEXTO_DOS_PRODUCTOS, "MCO111111111")).toEqual({
      soldQuantity: 50,
      itemId: "MCO111111111",
      dateCreated: "2024-01-01T00:00:00.000Z",
    });
    expect(leerDatosIncrustados(HTML_TEXTO_DOS_PRODUCTOS, "MCO222222222")).toEqual({
      soldQuantity: 9999,
      itemId: "MCO222222222",
      dateCreated: "2020-01-01T00:00:00.000Z",
    });
  });

  it("sin itemIdActual (la URL no trajo ningún id) -> todo null, nunca adivina", () => {
    expect(leerDatosIncrustados(HTML_DOS_PRODUCTOS, null)).toEqual({ soldQuantity: null, itemId: null, dateCreated: null });
  });

  it("sin ningún dato incrustado ni en texto plano: los 3 campos en null, nunca inventados", () => {
    expect(leerDatosIncrustados(HTML_SIN_NADA, "MCO111111111")).toEqual({ soldQuantity: null, itemId: null, dateCreated: null });
  });

  it("entrada vacía o inválida no revienta", () => {
    expect(leerDatosIncrustados("", "MCO111111111")).toEqual({ soldQuantity: null, itemId: null, dateCreated: null });
    expect(leerDatosIncrustados(null, "MCO111111111")).toEqual({ soldQuantity: null, itemId: null, dateCreated: null });
  });
});

describe("calcularVentasPromedioMes — issue #174, siempre marcado como estimado", () => {
  it("vendidos × 30 ÷ días desde date_created", () => {
    const ahora = new Date("2024-02-01T00:00:00.000Z").getTime();
    const creado = "2024-01-01T00:00:00.000Z"; // 31 días antes
    // 310 vendidos en 31 días -> 10 vendidos/día -> 300/mes.
    expect(calcularVentasPromedioMes(310, creado, ahora)).toBe(300);
  });

  it("redondea a 1 decimal, nunca un entero falso de precisión", () => {
    const ahora = new Date("2024-01-11T00:00:00.000Z").getTime(); // 10 días
    expect(calcularVentasPromedioMes(7, "2024-01-01T00:00:00.000Z", ahora)).toBe(21); // 7*30/10 = 21 exacto
    expect(calcularVentasPromedioMes(1, "2024-01-01T00:00:00.000Z", ahora)).toBe(3); // 1*30/10 = 3 exacto
  });

  it("una publicación de hoy mismo (0 días) nunca divide por cero — usa 1 día como mínimo", () => {
    const ahora = new Date("2024-01-01T08:00:00.000Z").getTime();
    const creado = "2024-01-01T07:59:00.000Z"; // minutos antes, mismo día
    expect(calcularVentasPromedioMes(5, creado, ahora)).toBe(150); // 5*30/1
  });

  it("sin vendidos, sin fecha, o fecha inválida -> null, nunca una cifra inventada", () => {
    expect(calcularVentasPromedioMes(null, "2024-01-01T00:00:00.000Z")).toBeNull();
    expect(calcularVentasPromedioMes(10, null)).toBeNull();
    expect(calcularVentasPromedioMes(10, "esto no es una fecha")).toBeNull();
  });

  // Issue #197 (Sharel, "estilo Selltrix") — "no dejar ventas en
  // cero": el ajuste, pasado como 4° y 5° argumento — sin ellos (como
  // en las pruebas de arriba, issue #174) sigue sin aplicar ningún
  // ajuste, mismo comportamiento de siempre.
  describe("ajuste estilo Selltrix (issue #197)", () => {
    const ahora = new Date("2024-01-31T00:00:00.000Z").getTime();
    const creado = "2024-01-01T00:00:00.000Z"; // 30 días antes

    it("Full: ×2.2, gana sobre el ajuste de etiqueta aunque también sea redondeado", () => {
      expect(calcularVentasPromedioMes(10, creado, ahora, true, false)).toBe(22); // 10*2.2*30/30
      expect(calcularVentasPromedioMes(10, creado, ahora, true, true)).toBe(22);
    });

    it("no Full + etiqueta redondeada (vendidosExacto === false): ×1.55", () => {
      expect(calcularVentasPromedioMes(10, creado, ahora, false, false)).toBe(15.5); // 10*1.55*30/30
    });

    it("no Full + vendidos exacto: sin ajuste (×1), igual que omitir los dos argumentos", () => {
      expect(calcularVentasPromedioMes(10, creado, ahora, false, true)).toBe(10);
      expect(calcularVentasPromedioMes(10, creado, ahora)).toBe(10);
    });
  });
});

describe("construirLinkSeguirProducto — issue #174, botón \"Seguir en Zilonix\"", () => {
  it("un itemId real arma el link con agregar=, encodeURIComponent incluido", () => {
    expect(construirLinkSeguirProducto("MCO123456789")).toBe(`${URL_APP}/panel/investigacion/seguimiento?agregar=MCO123456789`);
  });

  it("rechaza cualquier cosa que no sea MCO + dígitos — nunca arma un link con un id sin validar", () => {
    expect(construirLinkSeguirProducto("MCO-123456789")).toBeNull(); // con guión no pasa el patrón /^MCO\d+$/
    expect(construirLinkSeguirProducto("MCOABC")).toBeNull();
    expect(construirLinkSeguirProducto("")).toBeNull();
    expect(construirLinkSeguirProducto("MCO123; DROP TABLE x")).toBeNull();
    expect(construirLinkSeguirProducto(null)).toBeNull();
    expect(construirLinkSeguirProducto(undefined)).toBeNull();
  });
});

describe("construirLinkSeguirTienda — issue #174, botón \"Seguir tienda en Zilonix\"", () => {
  it("un seller_id real arma el link con agregar_tienda=", () => {
    expect(construirLinkSeguirTienda("123456")).toBe(`${URL_APP}/panel/investigacion/seguimiento?agregar_tienda=123456`);
  });

  it("rechaza cualquier cosa que no sean solo dígitos — nunca arma un link con un id sin validar", () => {
    expect(construirLinkSeguirTienda("123abc")).toBeNull();
    expect(construirLinkSeguirTienda("-123")).toBeNull();
    expect(construirLinkSeguirTienda("")).toBeNull();
    expect(construirLinkSeguirTienda("javascript:alert(1)")).toBeNull();
    expect(construirLinkSeguirTienda(null)).toBeNull();
    expect(construirLinkSeguirTienda(undefined)).toBeNull();
  });
});

describe("tipoDePagina — issue #192, bug real: una tienda oficial real no se reconocía", () => {
  it('path /tienda/ (www.mercadolibre.../tienda/...) -> "tienda"', () => {
    expect(tipoDePagina(LINK_TIENDA_OFICIAL_SIN_SELLER)).toBe("tienda");
    expect(tipoDePagina("https://www.mercadolibre.com.co/tienda/una-tienda-cualquiera")).toBe("tienda");
  });

  it('sigue reconociendo /perfil/, tienda.mercadolibre y ?CustId= como "tienda"', () => {
    expect(tipoDePagina("https://www.mercadolibre.com.co/perfil/una-tienda")).toBe("tienda");
    expect(tipoDePagina("https://tienda.mercadolibre.com.co/alguna-tienda")).toBe("tienda");
    expect(tipoDePagina("https://listado.mercadolibre.com.co/vendedor?CustId=123456789")).toBe("tienda");
  });

  it('un producto real sigue dando "producto", nunca "tienda"', () => {
    expect(tipoDePagina("https://articulo.mercadolibre.com.co/MCO-1234567890-reloj-_JM")).toBe("producto");
  });
});

describe("extraerCustIdDeUrl — issue #174, corrección: la forma clásica de \"visitar vendedor\" de Mercado Libre", () => {
  it("?CustId=<dígitos> en la URL, solo o junto con otros parámetros", () => {
    expect(extraerCustIdDeUrl("https://listado.mercadolibre.com.co/vendedor?CustId=123456789")).toBe("123456789");
    expect(extraerCustIdDeUrl("https://listado.mercadolibre.com.co/vendedor?algo=x&CustId=123456789")).toBe("123456789");
  });

  it("sin CustId, o entrada inválida -> null", () => {
    expect(extraerCustIdDeUrl("https://www.mercadolibre.com.co/perfil/una-tienda")).toBeNull();
    expect(extraerCustIdDeUrl(null)).toBeNull();
  });
});

describe("leerSellerIdDeTienda — issue #174, corrección real: nunca el user_id de quien mira la página", () => {
  it("lee seller_id del HTML cuando la URL no trae CustId", () => {
    const html = `<script>window.__ALGO__ = {"vendedor":{"seller_id":"555666777"}};</script>`;
    expect(leerSellerIdDeTienda(html, "https://www.mercadolibre.com.co/perfil/una-tienda")).toBe("555666777");
  });

  // Bug real corregido: user_id en el JSON incrustado de una página de
  // tienda suele ser el de la PERSONA con sesión iniciada en el
  // navegador — no el del vendedor. Antes se usaba como respaldo;
  // ahora, sin seller_id ni CustId, nunca se inventa con user_id.
  it("un HTML con SOLO user_id (sin seller_id) nunca da un id — ya no hay respaldo con user_id", () => {
    const html = `<script>window.__ALGO__ = {"perfil":{"user_id":888999000}};</script>`;
    expect(leerSellerIdDeTienda(html, "https://www.mercadolibre.com.co/perfil/una-tienda")).toBeNull();
  });

  it("si la URL trae ?CustId=, se usa ESE id antes que nada, aunque el HTML tenga otro seller_id distinto", () => {
    const html = `<script>window.__ALGO__ = {"vendedor":{"seller_id":"111111111"}};</script>`;
    expect(leerSellerIdDeTienda(html, "https://listado.mercadolibre.com.co/vendedor?CustId=222222222")).toBe("222222222");
  });

  it("sin seller_id en el HTML y sin CustId en la URL -> null, nunca inventado", () => {
    expect(leerSellerIdDeTienda("<html><body>sin nada</body></html>", "https://www.mercadolibre.com.co/perfil/una-tienda")).toBeNull();
    expect(leerSellerIdDeTienda("", "https://www.mercadolibre.com.co/perfil/una-tienda")).toBeNull();
    expect(leerSellerIdDeTienda(null, null)).toBeNull();
  });

  // Issue #192, bug real: una tienda oficial trae official_store_id en
  // la URL, nunca CustId ni seller_id en el HTML — nunca se adivina
  // que official_store_id es el seller_id (son conceptos distintos en
  // Mercado Libre, pueden no coincidir). null, igual que cualquier otro
  // caso sin id confiable — el panel (extension/content.js,
  // renderizarTienda) ya avisa "No se pudo confirmar el vendedor de
  // esta página" en vez de quedarse en silencio.
  it("tienda oficial con official_store_id en la URL pero sin seller_id en el HTML -> null, nunca official_store_id", () => {
    expect(leerSellerIdDeTienda("<html><body>sin seller_id</body></html>", LINK_TIENDA_OFICIAL_SIN_SELLER)).toBeNull();
  });
});
