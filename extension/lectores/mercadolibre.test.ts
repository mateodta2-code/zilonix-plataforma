import { describe, expect, it } from "vitest";
// extension/lectores/mercadolibre.js es JS plano (corre como content
// script de la extensión) pero exporta estas funciones con
// `module.exports` cuando `module` existe (mismo patrón que
// extension/seguridad.js) — alcanza para probarlas con un HTML de
// ejemplo, sin navegador ni DOM real.
import {
  calcularVentasPromedioMes,
  clasificarLinkListadoMl,
  construirLinkSeguirProducto,
  construirLinkSeguirTienda,
  construirPublicacionesTienda,
  detectarFullEnHtmlFicha,
  detectarFullEnHtmlTarjeta,
  elegirInventarioPrincipal,
  extraerCustIdDeUrl,
  extraerIdDeUrl,
  filtroFullActivoEnUrl,
  leerDatosIncrustados,
  leerInventarioMaximoDeTexto,
  leerResenasDesdeScript,
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

  // Issue #233 — bug real del smoke: antes de esta tarea, acá SOLO se
  // reconocía MCO (Colombia) — una página de producto de cualquier
  // otro país siempre devolvía null, rompiendo "Completar vendidos" y
  // "Seguir en Zilonix" para esos países.
  it("site-ids reales de otros países de Mercado Libre (MLA=Argentina, MLB=Brasil, etc) también funcionan", () => {
    expect(extraerIdDeUrl("https://articulo.mercadolibre.com.ar/MLA-987654321-auriculares-_JM")).toBe("MLA987654321");
    expect(extraerIdDeUrl("https://www.mercadolivre.com.br/p/MLB111222333")).toBe("MLB111222333");
    expect(extraerIdDeUrl("https://articulo.mercadolibre.com.pe/MPE-555666777-mochila-_JM")).toBe("MPE555666777");
  });
});

describe("leerDatosIncrustados — issue #174, amarrado al producto actual (nunca el de otro producto de la misma página)", () => {
  it("con dos productos en el JSON incrustado, agarra el sold_quantity/date_created del que coincide con el id actual", () => {
    expect(leerDatosIncrustados(HTML_DOS_PRODUCTOS, "MCO111111111")).toEqual({
      soldQuantity: 537,
      itemId: "MCO111111111",
      dateCreated: "2023-05-10T14:23:00.000Z",
      inventarioSelector: null,
    });
  });

  it("pidiendo el OTRO id de la misma página, trae los datos del otro producto — confirma que de verdad distingue cuál es cuál", () => {
    expect(leerDatosIncrustados(HTML_DOS_PRODUCTOS, "MCO222222222")).toEqual({
      soldQuantity: 9999,
      itemId: "MCO222222222",
      dateCreated: "2020-01-01T00:00:00.000Z",
      inventarioSelector: null,
    });
  });

  it("si el id actual no aparece en ningún lado del JSON, nunca devuelve el de otro producto — todo null", () => {
    expect(leerDatosIncrustados(HTML_DOS_PRODUCTOS, "MCO333333333")).toEqual({
      soldQuantity: null,
      itemId: null,
      dateCreated: null,
      inventarioSelector: null,
    });
  });

  it("respaldo de texto plano (sin __NORDIC_RENDERING_CTX__): agarra el sold_quantity cercano al id correcto, no el de otro producto más lejos en el HTML", () => {
    expect(leerDatosIncrustados(HTML_TEXTO_DOS_PRODUCTOS, "MCO111111111")).toEqual({
      soldQuantity: 50,
      itemId: "MCO111111111",
      dateCreated: "2024-01-01T00:00:00.000Z",
      inventarioSelector: null,
    });
    expect(leerDatosIncrustados(HTML_TEXTO_DOS_PRODUCTOS, "MCO222222222")).toEqual({
      soldQuantity: 9999,
      itemId: "MCO222222222",
      dateCreated: "2020-01-01T00:00:00.000Z",
      inventarioSelector: null,
    });
  });

  it("sin itemIdActual (la URL no trajo ningún id) -> todo null, nunca adivina", () => {
    expect(leerDatosIncrustados(HTML_DOS_PRODUCTOS, null)).toEqual({
      soldQuantity: null,
      itemId: null,
      dateCreated: null,
      inventarioSelector: null,
    });
  });

  it("sin ningún dato incrustado ni en texto plano: los 4 campos en null, nunca inventados", () => {
    expect(leerDatosIncrustados(HTML_SIN_NADA, "MCO111111111")).toEqual({
      soldQuantity: null,
      itemId: null,
      dateCreated: null,
      inventarioSelector: null,
    });
  });

  it("entrada vacía o inválida no revienta", () => {
    const vacio = { soldQuantity: null, itemId: null, dateCreated: null, inventarioSelector: null };
    expect(leerDatosIncrustados("", "MCO111111111")).toEqual(vacio);
    expect(leerDatosIncrustados(null, "MCO111111111")).toEqual(vacio);
  });

  // Issue #251 (revisión de Pablo + corrección de Mateo) — fixtures
  // construidos a partir de JSON real (archive.org): el caso de stock
  // alto (quantity_selector.available_quantity == selector.rows,
  // capado a 6, item real MCO1050084400 mayo/2026) y el caso de stock
  // bajo exacto (available_quantity:2 == stock real, item real
  // MCO1002047025 junio/2025) — ver leerProducto para cómo se combina
  // con el texto "(+N disponibles)".
  it("quantity_selector.available_quantity alto (capado por el tope de filas del dropdown) se lee igual, sin interpretar — eso lo hace leerProducto", () => {
    const html = `<!doctype html><html><body>
<script>
window.__NORDIC_RENDERING_CTX__ = {"page":{"components":{
  "item":{"id":"MCO1050084400","date_created":"2024-01-01T00:00:00.000Z"},
  "available_quantity":{"id":"available_quantity","picker":{"description":"(+10 disponibles)"},"quantity_selector":{"type":"drop_down_list","available_quantity":6,"minimum_quantity":1,"selector":{"rows":6}}}
}}};
</script>
</body></html>`;
    expect(leerDatosIncrustados(html, "MCO1050084400").inventarioSelector).toBe(6);
  });

  it("quantity_selector.available_quantity bajo (stock real bajo, sin tope) también se lee igual", () => {
    const html = `<!doctype html><html><body>
<script>
window.__NORDIC_RENDERING_CTX__ = {"page":{"components":{
  "item":{"id":"MCO1002047025","date_created":"2024-01-01T00:00:00.000Z"},
  "available_quantity":{"id":"available_quantity","picker":{"description":"(2 disponibles)"},"quantity_selector":{"type":"drop_down_list","available_quantity":2,"minimum_quantity":1,"selector":{"rows":2}}}
}}};
</script>
</body></html>`;
    expect(leerDatosIncrustados(html, "MCO1002047025").inventarioSelector).toBe(2);
  });

  it("sin quantity_selector en el JSON incrustado -> inventarioSelector null, nunca inventado", () => {
    expect(leerDatosIncrustados(HTML_DOS_PRODUCTOS, "MCO111111111").inventarioSelector).toBeNull();
  });

  // Issue #251 (corrección de Pablo, punto 10) — bug real: antes se
  // buscaba "quantity_selector" en TODO el JSON sin amarre al item
  // actual — con dos productos, cada uno con su PROPIO quantity_selector
  // anidado (un caso real: la página también trae recomendados con su
  // propio selector de cantidad), el recorrido en profundidad podía
  // devolver el de un recomendado en vez del del item que la persona
  // está mirando. Ahora se busca PRIMERO dentro del objeto ya amarrado
  // al id actual (buscarObjetoConId) — solo si ESE no tiene su propio
  // quantity_selector se cae al árbol completo (ver los dos tests de
  // arriba, donde el selector real SÍ vive fuera del objeto del item).
  it("dos productos, cada uno con su PROPIO quantity_selector anidado: agarra el del item actual, nunca el de un recomendado", () => {
    const html = `<!doctype html><html><body>
<script>
window.__NORDIC_RENDERING_CTX__ = {"page":{"components":{
  "recomendados":[{"id":"MCO222222222","date_created":"2020-01-01T00:00:00.000Z","quantity_selector":{"available_quantity":3}}],
  "item":{"id":"MCO111111111","date_created":"2023-05-10T14:23:00.000Z","quantity_selector":{"available_quantity":9}}
}}};
</script>
</body></html>`;
    expect(leerDatosIncrustados(html, "MCO111111111").inventarioSelector).toBe(9);
    expect(leerDatosIncrustados(html, "MCO222222222").inventarioSelector).toBe(3);
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

  it("rechaza cualquier cosa que no sea un site-id real de ML + dígitos — nunca arma un link con un id sin validar", () => {
    expect(construirLinkSeguirProducto("MCO-123456789")).toBeNull(); // con guión no pasa el patrón
    expect(construirLinkSeguirProducto("MCOABC")).toBeNull();
    expect(construirLinkSeguirProducto("")).toBeNull();
    expect(construirLinkSeguirProducto("MCO123; DROP TABLE x")).toBeNull();
    expect(construirLinkSeguirProducto("XYZ123456789")).toBeNull(); // site-id inventado, no uno real de ML
    expect(construirLinkSeguirProducto(null)).toBeNull();
    expect(construirLinkSeguirProducto(undefined)).toBeNull();
  });

  // Issue #233 — antes de esta tarea, el patrón solo aceptaba MCO: un
  // itemId real de otro país (ej. Argentina) nunca armaba un link.
  it("acepta site-ids reales de otros países de Mercado Libre", () => {
    expect(construirLinkSeguirProducto("MLA987654321")).toBe(`${URL_APP}/panel/investigacion/seguimiento?agregar=MLA987654321`);
    expect(construirLinkSeguirProducto("MLB111222333")).toBe(`${URL_APP}/panel/investigacion/seguimiento?agregar=MLB111222333`);
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

  // Issue #252 (smoke de staging) — bug real: las dos tiendas de
  // competencia probadas en staging (TECNOLOSYS COLOMBIA id
  // 145150422, TIENDAMERCADOMAX id 456866397) quedaron en "Sin dato"
  // después de "Actualizar todo". `construirLinkMlDeSeguimiento`
  // (lib/seguimiento/link.ts) arma el link como
  // `listado.mercadolibre.com.co/_CustId_{sellerId}` (confirmado real
  // en archive.org: 200, con "N resultados" — el mismo patrón de
  // listado filtrado por vendedor) — pero acá solo se reconocía
  // `?CustId=`/`&CustId=` (con "="), nunca `_CustId_` (con guión
  // bajo): esa URL caía al chequeo de `/listado` de más abajo y se
  // leía como una búsqueda genérica, nunca como la tienda.
  it('_CustId_123456 (sin "=", la forma real que arma "Actualizar todo" para una tienda) -> "tienda", nunca "listado"', () => {
    expect(tipoDePagina("https://listado.mercadolibre.com.co/_CustId_145150422")).toBe("tienda");
    expect(tipoDePagina("https://listado.mercadolibre.com.co/_CustId_456866397")).toBe("tienda");
  });

  it('un producto real sigue dando "producto", nunca "tienda"', () => {
    expect(tipoDePagina("https://articulo.mercadolibre.com.co/MCO-1234567890-reloj-_JM")).toBe("producto");
  });

  // Issue #233, punto B — bug real del smoke: Brasil usa el dominio
  // "mercadolivre" (marca real en portugués, mismo dominio que ya usa
  // urlListadoMl en background.js desde #227) — hasta esa tarea, acá
  // solo se reconocía "mercadolibre", así que una URL de listado de
  // Brasil devolvía null (ni "listado" ni nada) y leerListado NUNCA
  // se llegaba a llamar.
  //
  // Issue #235 — bug real APARTE, encontrado DESPUÉS de #233: el
  // subdominio de Brasil tampoco es "listado" (español), es "lista"
  // (portugués) — confirmado con una captura real de
  // archive.org/web, nunca adivinado (ver el comentario largo en
  // tipoDePagina). "listado.mercadolivre.com.br" (la URL que probaba
  // este mismo test hasta #235) NUNCA fue una URL real de Mercado
  // Livre — por eso este caso cambia de expectativa acá: antes
  // confirmaba (sin saberlo) una URL que no existe de verdad.
  it('lista.mercadolivre.com.br (Brasil, subdominio real confirmado) -> "listado"', () => {
    expect(tipoDePagina("https://lista.mercadolivre.com.br/cargadores?_zilonix_escaneo=1")).toBe("listado");
  });

  it('listado.mercadolivre.com.br (la URL vieja, incorrecta, nunca existió de verdad) -> null', () => {
    expect(tipoDePagina("https://listado.mercadolivre.com.br/cargadores?_zilonix_escaneo=1")).toBeNull();
  });

  it("un producto real de otro país (site-id distinto de MCO) también da \"producto\"", () => {
    expect(tipoDePagina("https://articulo.mercadolibre.com.ar/MLA-987654321-auriculares-_JM")).toBe("producto");
    expect(tipoDePagina("https://www.mercadolivre.com.br/p/MLB111222333")).toBe("producto");
  });
});

describe("clasificarLinkListadoMl — issue #233, bug real del smoke: solo reconocía MCO", () => {
  it("un link de catálogo (/p/) con site-id Colombia sigue funcionando (regresión)", () => {
    expect(clasificarLinkListadoMl("https://www.mercadolibre.com.co/p/MCO123456789")).toEqual({ tipo: "producto", id: "MCO123456789" });
  });

  it("un link \"user product\" (/up/MxxU) con site-id Colombia sigue funcionando (regresión)", () => {
    expect(clasificarLinkListadoMl("https://www.mercadolibre.com.co/up/MCOU123456")).toEqual({ tipo: "user_product", id: "MCOU123456" });
  });

  it("un link de publicación real (Mxx-dígitos) con site-id Colombia sigue dando itemId (regresión)", () => {
    expect(clasificarLinkListadoMl("https://articulo.mercadolibre.com.co/MCO-123456789-reloj-_JM")).toEqual({ tipo: "item", id: "MCO123456789" });
  });

  it("los mismos 3 formatos, con site-ids reales de otros países, ya NO se descartan", () => {
    expect(clasificarLinkListadoMl("https://www.mercadolibre.com.ar/p/MLA987654321")).toEqual({ tipo: "producto", id: "MLA987654321" });
    expect(clasificarLinkListadoMl("https://www.mercadolivre.com.br/up/MLBU654321")).toEqual({ tipo: "user_product", id: "MLBU654321" });
    expect(clasificarLinkListadoMl("https://articulo.mercadolivre.com.br/MLB-111222333-fone-_JM")).toEqual({ tipo: "item", id: "MLB111222333" });
  });

  it("un href sin ningún site-id real de Mercado Libre -> null (nunca se inventa un id)", () => {
    expect(clasificarLinkListadoMl("https://www.mercadolibre.com.co/categorias/tecnologia")).toBeNull();
    expect(clasificarLinkListadoMl("https://www.mercadolibre.com.co/XYZ-123456789-algo")).toBeNull(); // site-id inventado, no uno real
    expect(clasificarLinkListadoMl(null)).toBeNull();
    expect(clasificarLinkListadoMl("")).toBeNull();
  });
});

describe("extraerCustIdDeUrl — issue #174, corrección: la forma clásica de \"visitar vendedor\" de Mercado Libre", () => {
  it("?CustId=<dígitos> en la URL, solo o junto con otros parámetros", () => {
    expect(extraerCustIdDeUrl("https://listado.mercadolibre.com.co/vendedor?CustId=123456789")).toBe("123456789");
    expect(extraerCustIdDeUrl("https://listado.mercadolibre.com.co/vendedor?algo=x&CustId=123456789")).toBe("123456789");
  });

  // Issue #252 (smoke de staging) — misma causa que el bug de
  // tipoDePagina de arriba: `_CustId_123456` (la forma real que arma
  // "Actualizar todo" para una tienda, sin "=") no se reconocía acá —
  // aunque tipoDePagina ya clasificara bien la página como "tienda",
  // leerSellerIdDeTienda hubiera caído al respaldo del HTML (menos
  // confiable) en vez de leer el id directo de la URL.
  it("_CustId_<dígitos> (sin '=') también se reconoce", () => {
    expect(extraerCustIdDeUrl("https://listado.mercadolibre.com.co/_CustId_145150422")).toBe("145150422");
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

// Issue #225 — "Top 8 reseñas": fuente real confirmada en vivo por
// Cowork (zilonix-os-web, chrome-extension-busqueda/scraper-pdp-resenas.js).
// Fixture sintético pero con la misma forma documentada ahí: el script
// real sigue con ",styles:new Set([])};" DESPUÉS del objeto — el
// extractor de llaves balanceadas tiene que cortar justo al cerrar el
// objeto, nunca "hasta el final del script".
function scriptResenas(reviewsCapability: unknown): string {
  const objeto = { appProps: { pageProps: { initialState: { components: { reviews_capability_v3: reviewsCapability } } } } };
  return `_n.ctx.r=${JSON.stringify(objeto)},styles:new Set([])};`;
}

describe("leerResenasDesdeScript — issue #225 (Top 8 reseñas)", () => {
  it("texto vacío/sin el marcador _n.ctx.r= -> vacío, nunca lanza", () => {
    const vacio = { resenasTotales: null, promedio: null, positivas: 0, negativas: 0, resenasVisibles: 0, recientes30: 0, recientes90: 0 };
    expect(leerResenasDesdeScript("")).toEqual(vacio);
    expect(leerResenasDesdeScript("algo sin el marcador real")).toEqual(vacio);
  });

  it("lee total/promedio, positivas (5★+4★) y negativas (2★+1★) — índices confirmados por Cowork", () => {
    const texto = scriptResenas({
      rating: {
        amount: 123,
        average: 4.6,
        levels: [
          { index: 0, value: 80, percentage: 65 }, // 5★
          { index: 1, value: 20, percentage: 16 }, // 4★
          { index: 2, value: 10, percentage: 8 }, // 3★
          { index: 3, value: 8, percentage: 6 }, // 2★
          { index: 4, value: 5, percentage: 4 }, // 1★
        ],
      },
      reviews: [],
    });

    const resultado = leerResenasDesdeScript(texto);
    expect(resultado.resenasTotales).toBe(123);
    expect(resultado.promedio).toBe(4.6);
    expect(resultado.positivas).toBe(100); // 80 + 20
    expect(resultado.negativas).toBe(13); // 8 + 5
  });

  it("resenasVisibles = solo las reseñas que de verdad trae reviews[] (nunca el total real)", () => {
    const texto = scriptResenas({
      rating: { amount: 500, average: 4.2, levels: [] },
      reviews: [
        { rating: 5, comment: { date: "Hace 3 meses", country: "CO", content: { text: "A" } } },
        { rating: 4, comment: { date: "Hace 10 días", country: "CO", content: { text: "B" } } },
      ],
    });

    const resultado = leerResenasDesdeScript(texto);
    expect(resultado.resenasTotales).toBe(500);
    expect(resultado.resenasVisibles).toBe(2); // nunca 500 — eso sería inventar que se leyeron todas
  });

  it("recientes30/recientes90 a partir de la fecha relativa de cada reseña visible", () => {
    const texto = scriptResenas({
      rating: { amount: 3, average: 4, levels: [] },
      reviews: [
        { comment: { date: "Hace 10 días" } }, // <=30 y <=90
        { comment: { date: "Hace 2 meses" } }, // <=90, no <=30
        { comment: { date: "Hace 1 año" } }, // ni 30 ni 90
      ],
    });

    const resultado = leerResenasDesdeScript(texto);
    expect(resultado.recientes30).toBe(1);
    expect(resultado.recientes90).toBe(2);
  });

  it("sin reviews_capability_v3 en el objeto (otra forma de página) -> vacío, nunca inventa", () => {
    const texto = `_n.ctx.r=${JSON.stringify({ appProps: { pageProps: { initialState: { components: {} } } } })},styles:new Set([])};`;
    expect(leerResenasDesdeScript(texto).resenasTotales).toBeNull();
  });

  it("JSON cortado a mitad de carga -> vacío, nunca revienta", () => {
    expect(leerResenasDesdeScript('_n.ctx.r={"appProps":{"pageProps":')).toEqual({
      resenasTotales: null,
      promedio: null,
      positivas: 0,
      negativas: 0,
      resenasVisibles: 0,
      recientes30: 0,
      recientes90: 0,
    });
  });
});

describe("detectarFullEnHtmlTarjeta — issue #248 (vuelta 4), simplificado al mismo criterio de Zilonix OS", () => {
  // Issue #248 (vuelta 4) — Mateo pidió simplificar de vuelta al mismo
  // criterio simple que Zilonix OS ya usa en producción:
  //   const esFull = Boolean(li.querySelector('svg[aria-label="Enviado por FULL"]'));
  // Las capas de texto/atributos de #241/#242/#248 (vueltas 1-3) se
  // sacaron — el HTML real citado en la vuelta 3 confirmó que este
  // selector simple, solo, ya alcanza; el bug que quedaba era 100%
  // timing (ver content.js), no el detector. `detectarFullEnHtmlTarjeta`
  // queda como la versión de texto del MISMO selector único, solo
  // para poder probarla sin DOM (este proyecto no tiene jsdom).
  //
  // Issue #248, VUELTA 3 — HTML real citado por Pablo/Sharel (DOM
  // vivo, con el filtro Full apagado — el caso puntual que seguía en
  // 0/48 antes de confirmarse que era timing). Citado tal cual, sin
  // recortar, salvo envolverlo en un <li> real con su título.
  const TARJETA_REAL_SIN_FILTRO_VUELTA3 = `<li class="ui-search-layout__item"><div class="poly-card"><div class="poly-component__shipping-v2"><div class="poly-shipping-v2__item"><span><span class="polylabel-pill polylabel-fw-semibold">Llega gratis mañana</span><svg aria-label="Enviado por FULL" role="img" class="polylabel-icon" width="44" height="14" viewBox="0 0 41 13"><use href="#poly_full"></use></svg></span></div></div><h3 class="poly-component__title-wrapper">Tetero Anticólicos 260ml</h3></div></li>`;

  it("issue #248, HTML REAL confirmado (vuelta 3, poly-component__shipping-v2) -> true", () => {
    expect(detectarFullEnHtmlTarjeta(TARJETA_REAL_SIN_FILTRO_VUELTA3)).toBe(true);
  });

  it('issue #242, el selector exacto de Zilonix OS (aria-label="Enviado por FULL") -> true', () => {
    const tarjeta = `<li class="ui-search-layout__item"><div class="poly-component__shipped-from"><svg aria-label="Enviado por FULL"></svg></div></li>`;
    expect(detectarFullEnHtmlTarjeta(tarjeta)).toBe(true);
  });

  // Issue #240, revisión final — Zilonix OS confirma Full con DOS
  // marcadores reales: el aria-label exacto (arriba) Y la clase del
  // ícono del sprite (`icon-poly_full`) — algunas tarjetas (sobre todo
  // Ad) traen solo la clase, sin el aria-label exacto.
  it('tarjeta normal (orgánica) con el ícono por CLASE ("icon-poly_full"), sin aria-label exacto -> true', () => {
    const tarjeta = `<li class="ui-search-layout__item"><div class="poly-card"><span class="icon-poly_full"></span><h3 class="poly-component__title-wrapper">Biberón Anticólicos</h3></div></li>`;
    expect(detectarFullEnHtmlTarjeta(tarjeta)).toBe(true);
  });

  // Issue #248 (vuelta 6)/#240 — evidencia real: en un listado sin
  // filtro, los anuncios (Ad) son justamente los que más muestran el
  // badge Full. El detector en sí (esta función) nunca distingue
  // Ad de orgánico — esa separación vive en `leerListado`
  // (`estadisticasFull` cuenta ambos, `productos` solo orgánicos) —
  // acá solo se confirma que el badge se reconoce igual sin importar
  // si la tarjeta es un anuncio.
  it("tarjeta marcada como anuncio (Ad) con el badge Full real -> true (el detector no distingue Ad de orgánico, eso vive en leerListado)", () => {
    const tarjeta = `<li class="ui-search-layout__item"><div class="poly-card"><a class="poly-component__ads-promotions" href="#"></a><div class="poly-component__shipped-from"><svg aria-label="Enviado por FULL"></svg></div><h3 class="poly-component__title-wrapper">Biberón Anticólicos</h3></div></li>`;
    expect(detectarFullEnHtmlTarjeta(tarjeta)).toBe(true);
  });

  it("una tarjeta con envío gratis pero sin Full -> false (nunca confunde los dos)", () => {
    const tarjeta = `<li class="ui-search-layout__item"><div class="poly-card"><div class="poly-component__shipping">Envío gratis</div><h3 class="poly-component__title-wrapper">Gorra Deportiva Ajustable</h3></div></li>`;
    expect(detectarFullEnHtmlTarjeta(tarjeta)).toBe(false);
  });

  it('nunca un falso positivo: un título real con "Full" (ej. "Full HD") nunca cuenta — el selector único exige el svg con ese aria-label exacto, nunca texto suelto', () => {
    const tarjeta = `<li class="ui-search-layout__item"><h3 class="poly-component__title-wrapper">Televisor Full HD 42 Pulgadas</h3></li>`;
    expect(detectarFullEnHtmlTarjeta(tarjeta)).toBe(false);
  });

  it('advertencia explícita de Mateo: "poly-bookmark__icon-full" (ícono de favorito, nunca el programa Full) nunca cuenta como Full', () => {
    const tarjeta = `<li class="ui-search-layout__item"><div class="poly-card"><button class="poly-bookmark__icon-full" aria-label="Favorito"></button><div class="poly-component__delivery">Llega gratis mañana</div><h3 class="poly-component__title-wrapper">Biberón Anticólicos</h3></div></li>`;
    expect(detectarFullEnHtmlTarjeta(tarjeta)).toBe(false);
  });

  it("entradas vacías o inválidas -> false, nunca revienta", () => {
    expect(detectarFullEnHtmlTarjeta("")).toBe(false);
    expect(detectarFullEnHtmlTarjeta(null as unknown as string)).toBe(false);
    expect(detectarFullEnHtmlTarjeta(undefined as unknown as string)).toBe(false);
  });
});

describe("filtroFullActivoEnUrl — issue #248 (vuelta 2), señal fuerte del filtro Full de la URL", () => {
  // Issue #248, follow-up — el detector de DOM en capas seguía en
  // 0/48 aunque la persona ya tenía el filtro "Full" de Mercado Libre
  // puesto en la URL. Por DEFINICIÓN del filtro, todo lo que aparece
  // ahí ya es Full — no hace falta ningún selector de DOM para
  // confirmarlo. Formas reales conocidas: "_Envio_FULL" (#247) y
  // "shipping_highlighted_fulfillment" (follow-up de #248).
  it('URL real con el filtro "_Envio_FULL" (confirmada en #247) -> true', () => {
    expect(filtroFullActivoEnUrl("https://listado.mercadolibre.com.co/tetero_Envio_FULL")).toBe(true);
  });

  it('URL real con "shipping_highlighted_fulfillment" (confirmada en el follow-up de #248) -> true', () => {
    expect(filtroFullActivoEnUrl("https://listado.mercadolibre.com.co/tetero?shipping_highlighted_fulfillment=true")).toBe(true);
  });

  it("insensible a mayúsculas/minúsculas y a guion vs guion bajo", () => {
    expect(filtroFullActivoEnUrl("https://listado.mercadolibre.com.co/tetero_envio-full")).toBe(true);
  });

  it("URL de un listado normal, sin el filtro Full puesto -> false", () => {
    expect(filtroFullActivoEnUrl("https://listado.mercadolibre.com.co/tetero")).toBe(false);
  });

  it('URL con "full" suelto en otro contexto (nunca el filtro real) -> false', () => {
    expect(filtroFullActivoEnUrl("https://listado.mercadolibre.com.co/pantalla-full-hd")).toBe(false);
  });

  it("entradas vacías o inválidas -> false, nunca revienta", () => {
    expect(filtroFullActivoEnUrl("")).toBe(false);
    expect(filtroFullActivoEnUrl(null as unknown as string)).toBe(false);
    expect(filtroFullActivoEnUrl(undefined as unknown as string)).toBe(false);
  });
});

describe("detectarFullEnHtmlFicha — issue #245, ficha de producto (leerProducto), calco exacto del selector de Zilonix OS", () => {
  // Issue #245 — Mateo confirmó leyendo Zilonix OS hoy
  // (chrome-extension-busqueda/scraper-listado.js) que ese repo NO
  // tiene ningún detector de Full en la ficha de producto, solo en el
  // listado, con este selector exacto confirmado en producción:
  //   const esFull = Boolean(li.querySelector('svg[aria-label="Enviado por FULL"]'));
  // El intento de #243 (detectarFullEnHtmlEnvio, acotado a un bloque
  // de envío resuelto con selectores nunca confirmados en producción)
  // seguía gateando esFull a `false` cuando ese bloque no se resolvía
  // — exactamente el bug real que reportó Sharel con "Zelotes F35" en
  // 0.3.17. Esta función copia el MISMO selector de OS tal cual: match
  // EXACTO del aria-label (igual que el selector CSS de atributo, que
  // es exacto, no substring) — nunca un "full" suelto de texto plano.
  it('badge real con el ícono svg confirmado por OS (aria-label="Enviado por FULL") -> true', () => {
    const htmlFicha = `<div class="ui-pdp-container__row--shipping-summary" id="shipping_summary"><svg aria-label="Enviado por FULL" width="41" height="13"><use href="#poly_full"></use></svg><p class="ui-pdp-color--GREEN">Almacenado y enviado por FULL</p></div>`;
    expect(detectarFullEnHtmlFicha(htmlFicha)).toBe(true);
  });

  it("sin el ícono svg (ficha con envío gratis normal, sin Full) -> false", () => {
    const htmlFicha = `<div class="ui-pdp-container__row--shipping-summary"><p>Llega gratis hoy sábado por ser tu primera compra</p></div>`;
    expect(detectarFullEnHtmlFicha(htmlFicha)).toBe(false);
  });

  it('solo el texto "Almacenado y enviado por FULL", SIN el ícono svg -> false: a propósito, OS nunca confirmó un detector de Full por texto en la ficha, y no se inventa uno nuevo sin evidencia real', () => {
    const htmlFicha = `<div id="shipping_summary"><p class="ui-pdp-color--GREEN">Almacenado y enviado por FULL</p></div>`;
    expect(detectarFullEnHtmlFicha(htmlFicha)).toBe(false);
  });

  it('"Full HD" en el título del producto, sin el ícono svg, nunca cuenta', () => {
    const htmlFicha = `<html><body><h1 class="ui-pdp-title">Televisor Full HD 42 Pulgadas</h1><div id="shipping_summary"><p>Llega gratis hoy</p></div></body></html>`;
    expect(detectarFullEnHtmlFicha(htmlFicha)).toBe(false);
  });

  it("entradas vacías o inválidas -> false, nunca revienta", () => {
    expect(detectarFullEnHtmlFicha("")).toBe(false);
    expect(detectarFullEnHtmlFicha(null as unknown as string)).toBe(false);
    expect(detectarFullEnHtmlFicha(undefined as unknown as string)).toBe(false);
  });
});

describe("leerInventarioMaximoDeTexto — issue #251, inventario leído de la ficha abierta", () => {
  // Issue #251 — Mercado Libre no deja ver `available_quantity` real
  // de una publicación AJENA por la API (403/ausente, confirmado en
  // #250) — se lee del selector de cantidad de la FICHA abierta en
  // pantalla. Texto real confirmado (archive.org, ficha real de
  // Mercado Libre Colombia, item MCO1050084400, snapshot de mayo/2026
  // — acceso directo sigue bloqueado desde este sandbox):
  //   <span class="ui-pdp-buybox__quantity__available">(+10 disponibles)</span>
  it('texto real confirmado, "(+10 disponibles)" -> {valor: 10, aproximado: true}', () => {
    expect(leerInventarioMaximoDeTexto("(+10 disponibles)")).toEqual({ valor: 10, aproximado: true });
  });

  it('stock bajo, sin "+" (nunca confirmado en una ficha real, pero simétrico al criterio ya usado para "+N vendidos") -> {valor: 5, aproximado: false}', () => {
    expect(leerInventarioMaximoDeTexto("5 disponibles")).toEqual({ valor: 5, aproximado: false });
  });

  it("miles con separador real de Mercado Libre (punto) -> número completo, nunca cortado en el primer punto", () => {
    expect(leerInventarioMaximoDeTexto("(+1.200 disponibles)")).toEqual({ valor: 1200, aproximado: true });
  });

  it("texto sin el patrón esperado -> valor null, nunca 0 inventado", () => {
    expect(leerInventarioMaximoDeTexto("Sin stock")).toEqual({ valor: null, aproximado: false });
  });

  it("entradas vacías o inválidas -> valor null, nunca revienta", () => {
    expect(leerInventarioMaximoDeTexto("")).toEqual({ valor: null, aproximado: false });
    expect(leerInventarioMaximoDeTexto(null as unknown as string)).toEqual({ valor: null, aproximado: false });
    expect(leerInventarioMaximoDeTexto(undefined as unknown as string)).toEqual({ valor: null, aproximado: false });
  });
});

describe("elegirInventarioPrincipal — issue #251 (revisión de Pablo + corrección de Mateo), texto vs JSON incrustado", () => {
  // Evidencia real (archive.org): MCO1050084400 (mayo/2026) tenía stock
  // real "10 o más" (Mateo confirmó en vivo: 27) pero
  // quantity_selector.available_quantity valía 6 (el tope de filas del
  // dropdown, nunca el stock real) — con un "+" en el texto, SIEMPRE
  // manda el texto, nunca el número del selector.
  it('con "+" en el texto (stock alto, selector capado a 6): manda el texto, nunca el selector', () => {
    expect(elegirInventarioPrincipal({ valor: 10, aproximado: true }, 6)).toEqual({ valor: 10, aproximado: true });
  });

  // Evidencia real: MCO1002047025 (junio/2025), stock bajo real,
  // quantity_selector.available_quantity:2 == texto "2 disponibles"
  // (sin "+") == el disponible real exacto.
  it('sin "+" en el texto y selector por debajo del tope (stock bajo real): usa el selector, marcado exacto', () => {
    expect(elegirInventarioPrincipal({ valor: 2, aproximado: false }, 2)).toEqual({ valor: 2, aproximado: false });
  });

  it("selector en o por encima del tope de filas (6): nunca se usa como exacto, aunque el texto no tenga \"+\"", () => {
    expect(elegirInventarioPrincipal({ valor: 6, aproximado: false }, 6)).toEqual({ valor: 6, aproximado: false });
  });

  it("sin inventarioSelector (JSON no lo trajo): usa el texto tal cual, sea el que sea", () => {
    expect(elegirInventarioPrincipal({ valor: null, aproximado: false }, null)).toEqual({ valor: null, aproximado: false });
    expect(elegirInventarioPrincipal({ valor: 10, aproximado: true }, null)).toEqual({ valor: 10, aproximado: true });
  });

  it("selector bajo pero el texto no trajo ningún valor (selector sin \"+\" de por sí): usa el selector, nunca inventa 0", () => {
    expect(elegirInventarioPrincipal({ valor: null, aproximado: false }, 3)).toEqual({ valor: 3, aproximado: false });
  });
});

describe("construirPublicacionesTienda — issue #251 punto 8 (revisión de Pablo), lector de tienda sin DOM", () => {
  // Formatos reales de href confirmados arriba (clasificarLinkListadoMl,
  // issue #233/#227): catálogo (/p/MCO...) y "user product" (/up/MCOU...)
  // también se clasifican y entran a idsVisibles — el filtro real (solo
  // "producto" cuenta como seguible) vive en otro lado (construirLinkSeguirProducto/UI),
  // no acá: esta función solo recolecta lo que el listado mostró.
  it('"752 resultados" (total real de una tienda grande) junto con las tarjetas visibles -> total + ids, sin títulos falsos', () => {
    expect(
      construirPublicacionesTienda("752 resultados", [
        "https://articulo.mercadolibre.com.co/MCO-111111111-producto-uno-_JM",
        "https://www.mercadolibre.com.co/p/MCO222222222",
      ])
    ).toEqual({ total: 752, idsVisibles: ["MCO111111111", "MCO222222222"] });
  });

  it("una tarjeta sin link de título (linkEl null) o con href no clasificable -> se descarta, nunca un id inventado", () => {
    expect(
      construirPublicacionesTienda("3 resultados", [
        null,
        "https://articulo.mercadolibre.com.co/MCO-333333333-producto-tres-_JM",
        "https://www.mercadolibre.com.co/ofertas",
      ])
    ).toEqual({ total: 3, idsVisibles: ["MCO333333333"] });
  });

  it("sin texto de total (landing de tienda oficial, antes de \"Todos los productos\") -> total null, nunca 0 inventado", () => {
    expect(construirPublicacionesTienda(null, ["https://articulo.mercadolibre.com.co/MCO-444444444-producto-_JM"])).toEqual({
      total: null,
      idsVisibles: ["MCO444444444"],
    });
  });

  it("sin ninguna tarjeta visible -> idsVisibles vacío, total igual se lee si está", () => {
    expect(construirPublicacionesTienda("752 resultados", [])).toEqual({ total: 752, idsVisibles: [] });
    expect(construirPublicacionesTienda("752 resultados", undefined)).toEqual({ total: 752, idsVisibles: [] });
  });

  it("miles con separador real de Mercado Libre (punto) en el total -> número completo", () => {
    expect(construirPublicacionesTienda("1.200 resultados", [])).toEqual({ total: 1200, idsVisibles: [] });
  });

  // Issue #252 (smoke de staging) — texto y hrefs REALES, tal cual
  // los trae una página de tienda capturada en archive.org
  // (listado.mercadolibre.com.co/_CustId_1012038349, snapshot de
  // mayo/2025 — acceso directo sigue bloqueado desde este sandbox):
  // el total real ("23 resultados", `.ui-search-search-result__quantity-results`)
  // y 3 hrefs reales de `a.poly-component__title` (uno de catálogo
  // con `/p/`, dos de publicación directa) — confirma que el lector
  // funciona con el HTML real de ESTA página puntual, no solo con un
  // ejemplo inventado a mano.
  it("HTML real de una página de tienda (_CustId_, archive.org, mayo/2025): total + ids reales", () => {
    const totalReal = "23 resultados";
    const hrefsReales = [
      "https://www.mercadolibre.com.co/cargador-hp-g4-dv6-dv7-g42-g62-g72-compaq-cq42-cq56-cq60/p/MCO38280231?pdp_filters=seller_id%3A1012038349#polycard_client=search-nordic&searchVariation=MCO38280231&position=1",
      "https://articulo.mercadolibre.com.co/MCO-1325134601-soportes-decorativos-para-telefono-de-dibujos-animados-_JM#polycard_client=search-nordic&position=2",
      "https://articulo.mercadolibre.com.co/MCO-1534758597-shenzhen-12-v-12-a-con-certificacion-ce-y-gs-_JM?searchVariation=186805913835#polycard_client=search-nordic",
    ];
    expect(construirPublicacionesTienda(totalReal, hrefsReales)).toEqual({
      total: 23,
      idsVisibles: ["MCO38280231", "MCO1325134601", "MCO1534758597"],
    });
  });
});
