import { describe, expect, it } from "vitest";
// extension/lectores/mercadolibre.js es JS plano (corre como content
// script de la extensión) pero exporta estas dos funciones con
// `module.exports` cuando `module` existe (mismo patrón que
// extension/seguridad.js) — alcanza para probarlas con un HTML de
// ejemplo, sin navegador ni DOM real.
import { calcularVentasPromedioMes, leerDatosIncrustados } from "./mercadolibre.js";

// HTML de ejemplo real-ista: dos <script> — uno con otra variable
// cualquiera (para confirmar que no se confunde), y el que de verdad
// importa, __NORDIC_RENDERING_CTX__, con sold_quantity/item_id/
// date_created anidados varios niveles adentro (como en la página
// real) y, a propósito, una comilla escapada y llaves "{ }" sueltas
// DENTRO de un string (el título) — para probar que el extractor de
// JSON balanceado no corta el objeto a mitad de camino ahí.
const HTML_CON_VARIABLE_INCRUSTADA = `<!doctype html><html><head></head><body>
<script>window.__PRELOADED_STATE__ = {"otraCosa": true};</script>
<script>
window.__NORDIC_RENDERING_CTX__ = {"page":{"components":{"item":{"id":"MCO123456789","sold_quantity":537,"date_created":"2023-05-10T14:23:00.000Z","title":"Reloj con \\"comillas\\" y { llaves } adentro"}}}};
</script>
</body></html>`;

// Mismos 3 datos, pero SIN la variable __NORDIC_RENDERING_CTX__ —
// simula que Mercado Libre cambió el nombre de la variable o la
// movió: el respaldo de texto plano que pide la tarea tiene que
// encontrarlos igual, buscando directo "sold_quantity" en el HTML.
const HTML_SOLO_CON_TEXTO_PLANO = `<!doctype html><html><body>
<script>window.__OTRA_VARIABLE_FUTURA__ = {"resultado":{"id":"MCO987654321","sold_quantity":892,"date_created":"2024-01-01T00:00:00.000Z"}};</script>
</body></html>`;

// La variable existe pero el JSON viene CORTADO a mitad de carga
// (nunca cierra la llave) — el extractor balanceado tiene que
// devolver null sin reventar, y caer al mismo respaldo de texto.
const HTML_CON_JSON_CORTADO = `<!doctype html><html><body>
<script>window.__NORDIC_RENDERING_CTX__ = {"item": {"sold_quantity": 42, "date_crea</script>
</body></html>`;

const HTML_SIN_NADA = `<!doctype html><html><body><p>Página sin ningún dato incrustado</p></body></html>`;

describe("leerDatosIncrustados — issue #174, vendidos exacto desde el JSON que ML incrusta en el HTML", () => {
  it("lee sold_quantity/item_id/date_created desde __NORDIC_RENDERING_CTX__ (JSON balanceado, con llaves/comillas dentro de un string)", () => {
    const resultado = leerDatosIncrustados(HTML_CON_VARIABLE_INCRUSTADA);
    expect(resultado).toEqual({
      soldQuantity: 537,
      itemId: "MCO123456789",
      dateCreated: "2023-05-10T14:23:00.000Z",
    });
  });

  it("si no está __NORDIC_RENDERING_CTX__, cae al respaldo de texto plano (buscar \"sold_quantity\" directo en el HTML)", () => {
    const resultado = leerDatosIncrustados(HTML_SOLO_CON_TEXTO_PLANO);
    expect(resultado).toEqual({
      soldQuantity: 892,
      itemId: "MCO987654321",
      dateCreated: "2024-01-01T00:00:00.000Z",
    });
  });

  it("JSON cortado a mitad de carga: nunca revienta, cae al mismo respaldo de texto plano para lo que sí se pueda leer", () => {
    const resultado = leerDatosIncrustados(HTML_CON_JSON_CORTADO);
    expect(resultado.soldQuantity).toBe(42);
    expect(resultado.dateCreated).toBeNull(); // date_created quedó cortado antes de cerrar la comilla — nunca se inventa
  });

  it("sin ningún dato incrustado ni en texto plano: los 3 campos en null, nunca inventados", () => {
    expect(leerDatosIncrustados(HTML_SIN_NADA)).toEqual({ soldQuantity: null, itemId: null, dateCreated: null });
  });

  it("entrada vacía o inválida no revienta", () => {
    expect(leerDatosIncrustados("")).toEqual({ soldQuantity: null, itemId: null, dateCreated: null });
    // leerDatosIncrustados() revisa `typeof html !== "string"` antes de
    // tocar nada — null/undefined en vivo (ej. outerHTML inesperado)
    // nunca revienta. La firma TS de un .js con allowJs no obliga a
    // pasar un string, así que esto no necesita @ts-expect-error.
    expect(leerDatosIncrustados(null)).toEqual({ soldQuantity: null, itemId: null, dateCreated: null });
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
