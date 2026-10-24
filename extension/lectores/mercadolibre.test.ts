import { describe, expect, it } from "vitest";
// extension/lectores/mercadolibre.js es JS plano (corre como content
// script de la extensión) pero exporta estas funciones con
// `module.exports` cuando `module` existe (mismo patrón que
// extension/seguridad.js) — alcanza para probarlas con un HTML de
// ejemplo, sin navegador ni DOM real.
import { calcularVentasPromedioMes, extraerIdDeUrl, leerDatosIncrustados } from "./mercadolibre.js";

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
});
