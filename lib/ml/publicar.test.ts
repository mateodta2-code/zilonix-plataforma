import { randomUUID } from "crypto";
import { eq } from "drizzle-orm";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { dbComoEmpresa } from "@/db/empresa-context";
import { auditoria, cuentasMl, empresas, productosMl, publicaciones } from "@/db/schema";
import { afirmarAislamiento, crearDosEmpresas } from "@/db/test-utils/aislamiento";
import { cifrarToken } from "@/lib/cifrado";
import { leerArbolCategorias, publicarProductoEnCuentas } from "./publicar";

// Tarea 2.11 ("Publicar producto y clip") — pruebas de integración
// contra Postgres real (RLS incluido) con `fetch` mockeado, mismo
// patrón ya usado en lib/ml/despachos.test.ts y lib/ml/bandeja.test.ts.
// Cada prueba referencia la regla real del reporte de investigación
// que está verificando — no son solo "la función corre sin tirar error".

function jsonRes(status: number, data: unknown): Response {
  return { ok: status >= 200 && status < 300, status, json: async () => data, text: async () => JSON.stringify(data) } as Response;
}

type Handler = (url: string, init?: RequestInit) => Response | Promise<Response>;

function enrutarFetch(reglas: [RegExp, Handler][]) {
  return vi.fn(async (url: unknown, init?: RequestInit) => {
    const u = String(url);
    for (const [patron, handler] of reglas) {
      if (patron.test(u)) return handler(u, init);
    }
    throw new Error(`fetch no mockeado en esta prueba: ${u}`);
  });
}

// Categoría de prueba sin ningún atributo obligatorio raro — solo GTIN/
// EMPTY_GTIN_REASON/BRAND, para poder probar esos árboles de decisión
// sin ruido de otras reglas.
const ATRIBUTOS_CATEGORIA_BASICA = [
  { id: "EMPTY_GTIN_REASON", name: "Motivo de no tener GTIN", values: [{ name: "El producto no tiene código registrado" }] },
  { id: "BRAND", name: "Marca", tags: { catalog_required: true }, values: [{ name: "Nike" }, { name: "Genérica" }] },
];

function reglasBase(opts?: { atributosCategoria?: unknown[]; onCrearItem?: (body: Record<string, unknown>) => Response | null }): [RegExp, Handler][] {
  let llamadasCrearItem = 0;
  return [
    // Tarea 2.11, punto 3: cuentaIdExterna ahora tiene que cumplir
    // /^\d+$/ (leerCuentaMl, lib/ml/cliente.ts, valida ANTES de armar
    // la URL) — el patrón de abajo matchea esa forma real, no el
    // literal "ml-user-" que usaban las cuentas de prueba viejas.
    [/\/users\/\d+$/, () => jsonRes(200, { site_id: "MCO" })],
    [/\/sites\/MCO\/domain_discovery\/search/, () => jsonRes(200, [{ category_id: "MCO1234", category_name: "Categoría de prueba", domain_name: "MCO-TEST" }])],
    [/\/categories\/MCO1234\/attributes/, () => jsonRes(200, opts?.atributosCategoria ?? ATRIBUTOS_CATEGORIA_BASICA)],
    [/\/categories\/MCO1234$/, () => jsonRes(200, { max_pictures_per_item: 10 })],
    [
      /\/items$/,
      (_u, init) => {
        llamadasCrearItem += 1;
        const body = JSON.parse(String(init?.body ?? "{}"));
        const respuestaOverride = opts?.onCrearItem?.(body);
        if (respuestaOverride) return respuestaOverride;
        return jsonRes(201, { id: `MCOITEM${llamadasCrearItem}`, permalink: `https://articulo.mercadolibre.com.co/MCOITEM${llamadasCrearItem}`, status: "active" });
      },
    ],
    [/\/items\/MCOITEM\d+\/description$/, () => jsonRes(200, {})],
    [/\/items\/MCOITEM\d+$/, () => jsonRes(200, { status: "paused" })],
  ];
}

// Tarea 2.11, punto 3: cuentaIdExterna tiene que cumplir /^\d+$/
// (mismo patrón que cliente.ts) — leerCuentaMl valida ANTES de armar
// la URL, así que el literal viejo "ml-user-{sufijo}" nunca llegaría a
// mockearse, rompería la prueba con "cuentaIdExterna inválido" antes
// de tocar fetch.
function cuentaIdExternaDePrueba(): string {
  return `${Date.now()}${Math.floor(Math.random() * 10_000)}`;
}

async function crearEmpresaYCuenta(sufijo: string) {
  const empresaId = randomUUID();
  await dbComoEmpresa(empresaId, (tx) => tx.insert(empresas).values({ id: empresaId, nombre: `Empresa publicar ${sufijo}`, nit: `TEST-PUB-${sufijo}` }));
  const [cuenta] = await dbComoEmpresa(empresaId, (tx) =>
    tx
      .insert(cuentasMl)
      .values({
        empresaId,
        cuentaIdExterna: cuentaIdExternaDePrueba(),
        nickname: `VENDEDOR_${sufijo}`,
        accessTokenCifrado: cifrarToken("access"),
        refreshTokenCifrado: cifrarToken("refresh"),
        tokenExpiraTs: new Date(Date.now() + 3600_000),
      })
      .returning({ id: cuentasMl.id })
  );
  return { empresaId, cuentaId: cuenta.id };
}

async function crearProducto(empresaId: string, cuentaId: string, overrides: Partial<typeof productosMl.$inferInsert> = {}) {
  const [producto] = await dbComoEmpresa(empresaId, (tx) =>
    tx
      .insert(productosMl)
      .values({
        empresaId,
        precio: "50000",
        stock: 10,
        cuentasSeleccionadas: [cuentaId],
        porCuenta: { [cuentaId]: { titulo: "Producto de prueba", descripcion: "Descripción de prueba" } },
        ...overrides,
      })
      .returning()
  );
  return producto;
}

// ADENDO UX de Publicar, punto 2 — árbol de categorías (navegación
// manual nivel por nivel, cuando ni la predicción automática ni la
// búsqueda de texto dan con la categoría correcta). Sin DB real
// (nunca toca productos_ml/cuentas_ml) — solo fetch mockeado, como
// cliente.test.ts.
describe("leerArbolCategorias — ADENDO UX de Publicar", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("sin categoryId: trae la raíz real del sitio (GET /sites/{siteId}/categories, CON token)", async () => {
    vi.stubGlobal(
      "fetch",
      enrutarFetch([
        [
          /\/sites\/MCO\/categories$/,
          (_u, init) => {
            expect((init?.headers as Record<string, string> | undefined)?.Authorization).toBe("Bearer token-real");
            return jsonRes(200, [
              { id: "MCO1000", name: "Electrónica" },
              { id: "MCO1001", name: "Hogar" },
            ]);
          },
        ],
      ])
    );
    const nodo = await leerArbolCategorias("MCO", "token-real");
    expect(nodo).toEqual({
      categoryId: "",
      categoryName: "",
      esRaiz: true,
      esHoja: false,
      pathFromRoot: [],
      children: [
        { id: "MCO1000", name: "Electrónica" },
        { id: "MCO1001", name: "Hogar" },
      ],
    });
  });

  it("con categoryId y children reales: esHoja=false, trae el breadcrumb (pathFromRoot)", async () => {
    vi.stubGlobal(
      "fetch",
      enrutarFetch([
        [
          /\/categories\/MCO1000$/,
          () =>
            jsonRes(200, {
              id: "MCO1000",
              name: "Electrónica",
              children_categories: [{ id: "MCO1010", name: "Celulares" }],
              path_from_root: [{ id: "MCO1000", name: "Electrónica" }],
            }),
        ],
      ])
    );
    const nodo = await leerArbolCategorias("MCO", "token-real", "MCO1000");
    expect(nodo.esRaiz).toBe(false);
    expect(nodo.esHoja).toBe(false);
    expect(nodo.children).toEqual([{ id: "MCO1010", name: "Celulares" }]);
    expect(nodo.pathFromRoot).toEqual([{ id: "MCO1000", name: "Electrónica" }]);
  });

  // La señal real de "es hoja" es children_categories vacío — nunca se
  // adivina por otro campo (ej. un value_type, un nombre de dominio).
  it("con categoryId SIN children (categoría hoja): esHoja=true", async () => {
    vi.stubGlobal(
      "fetch",
      enrutarFetch([
        [/\/categories\/MCO1234$/, () => jsonRes(200, { id: "MCO1234", name: "Relojes de Pulsera", children_categories: [], path_from_root: [] })],
      ])
    );
    const nodo = await leerArbolCategorias("MCO", "token-real", "MCO1234");
    expect(nodo.esHoja).toBe(true);
    expect(nodo.children).toEqual([]);
  });
});

describe("publicarProductoEnCuentas (tarea 2.11) — camino clásico", () => {
  vi.setConfig({ testTimeout: 15_000 });
  afterEach(() => vi.unstubAllGlobals());

  it("publica con éxito en una cuenta, sincroniza publicaciones y deja auditoría", async () => {
    const { empresaId, cuentaId } = await crearEmpresaYCuenta(randomUUID().slice(0, 8));
    const producto = await crearProducto(empresaId, cuentaId);
    vi.stubGlobal("fetch", enrutarFetch(reglasBase()));

    const resultados = await publicarProductoEnCuentas(empresaId, producto.id);
    expect(resultados).toHaveLength(1);
    expect(resultados[0].ok).toBe(true);

    const [fila] = await dbComoEmpresa(empresaId, (tx) => tx.select().from(productosMl).where(eq(productosMl.id, producto.id)));
    expect(fila.estado).toBe("publicado");
    expect(fila.titulo).toBe("Producto de prueba");

    const publicados = await dbComoEmpresa(empresaId, (tx) => tx.select().from(publicaciones).where(eq(publicaciones.empresaId, empresaId)));
    expect(publicados).toHaveLength(1);

    const rastro = await dbComoEmpresa(empresaId, (tx) => tx.select().from(auditoria).where(eq(auditoria.empresaId, empresaId)));
    expect(rastro.some((a) => a.entidad === "Mercado Libre")).toBe(true);
  });

  // Tarea 2.11, punto 4 — reemplaza la prueba anterior (solo SELECT)
  // por la plantilla real de aislamiento (issue #39,
  // db/test-utils/aislamiento.ts): confirma que empresa B nunca VE,
  // EDITA ni BORRA una fila de productos_ml de empresa A — no solo que
  // no la ve.
  it("empresa B nunca ve, edita ni borra un producto de empresa A (plantilla de aislamiento, issue #39)", async () => {
    const contexto = await crearDosEmpresas();
    const [cuentaA] = await dbComoEmpresa(contexto.empresaAId, (tx) =>
      tx
        .insert(cuentasMl)
        .values({
          empresaId: contexto.empresaAId,
          cuentaIdExterna: cuentaIdExternaDePrueba(),
          nickname: "VENDEDOR_AISLA_A",
          accessTokenCifrado: cifrarToken("access"),
          refreshTokenCifrado: cifrarToken("refresh"),
          tokenExpiraTs: new Date(Date.now() + 3600_000),
        })
        .returning({ id: cuentasMl.id })
    );

    await afirmarAislamiento(contexto, productosMl, (tx, empresaId) =>
      tx
        .insert(productosMl)
        .values({
          empresaId,
          precio: "50000",
          stock: 10,
          cuentasSeleccionadas: [cuentaA.id],
          porCuenta: { [cuentaA.id]: { titulo: "Producto de prueba (aislamiento)" } },
        })
        .returning({ id: productosMl.id })
    );
  });

  // Tarea 2.11, punto 3 — "si no cumple, error claro y nunca se llama
  // a ML". Una categoría manual (producto.categoriasOverride, la que
  // la persona puede escribir a mano en el formulario) se valida igual
  // que cualquier otro id antes de armar la URL de leerCategoriaMl.
  it("categoryId manual con forma inválida: la cuenta queda 'con_errores', nunca llama a Mercado Libre con esa URL", async () => {
    const { empresaId, cuentaId } = await crearEmpresaYCuenta(randomUUID().slice(0, 8));
    const producto = await crearProducto(empresaId, cuentaId, {
      categoriasOverride: { "MCO::Producto de prueba": "MCO1/../users/me" },
    });
    const fetchMock = enrutarFetch(reglasBase());
    vi.stubGlobal("fetch", fetchMock);
    const resultados = await publicarProductoEnCuentas(empresaId, producto.id);
    expect(resultados[0].ok).toBe(false);
    expect(fetchMock.mock.calls.some((c) => String(c[0]).includes("/categories/MCO1"))).toBe(false);
  });

  it("cero cuentas elegibles ⇒ 'con_errores', nunca 'publicado' (bug real corregido del sistema actual)", async () => {
    const { empresaId, cuentaId } = await crearEmpresaYCuenta(randomUUID().slice(0, 8));
    // cuentasSeleccionadas apunta a una cuenta que no existe en esta empresa.
    const producto = await crearProducto(empresaId, cuentaId, { cuentasSeleccionadas: [randomUUID()] });
    vi.stubGlobal("fetch", enrutarFetch(reglasBase()));
    const resultados = await publicarProductoEnCuentas(empresaId, producto.id);
    expect(resultados).toHaveLength(0);
    const [fila] = await dbComoEmpresa(empresaId, (tx) => tx.select().from(productosMl).where(eq(productosMl.id, producto.id)));
    expect(fila.estado).toBe("con_errores");
  });

  it("GTIN: sin código real pero la categoría ofrece EMPTY_GTIN_REASON ⇒ se manda ese atributo (MCO8830/MCO39965)", async () => {
    const { empresaId, cuentaId } = await crearEmpresaYCuenta(randomUUID().slice(0, 8));
    const producto = await crearProducto(empresaId, cuentaId);
    let bodyCapturado: Record<string, unknown> | null = null;
    vi.stubGlobal(
      "fetch",
      enrutarFetch(
        reglasBase({
          onCrearItem: (body) => {
            bodyCapturado = body;
            return null;
          },
        })
      )
    );
    await publicarProductoEnCuentas(empresaId, producto.id);
    const attrs = bodyCapturado!.attributes as { id: string; value_name: string }[];
    expect(attrs.find((a) => a.id === "EMPTY_GTIN_REASON")?.value_name).toBe("El producto no tiene código registrado");
    expect(attrs.some((a) => a.id === "GTIN")).toBe(false);
  });

  it("GTIN real escrito a mano se manda tal cual, nunca se pisa", async () => {
    const { empresaId, cuentaId } = await crearEmpresaYCuenta(randomUUID().slice(0, 8));
    const producto = await crearProducto(empresaId, cuentaId, { atributosExtra: { GTIN: "7701234567890" } });
    let bodyCapturado: Record<string, unknown> | null = null;
    vi.stubGlobal("fetch", enrutarFetch(reglasBase({ onCrearItem: (body) => ((bodyCapturado = body), null) })));
    await publicarProductoEnCuentas(empresaId, producto.id);
    const attrs = bodyCapturado!.attributes as { id: string; value_name: string }[];
    expect(attrs.find((a) => a.id === "GTIN")?.value_name).toBe("7701234567890");
  });

  it("BRAND genérica proactiva: nadie puso marca ⇒ se manda la opción genérica real de la categoría", async () => {
    const { empresaId, cuentaId } = await crearEmpresaYCuenta(randomUUID().slice(0, 8));
    const producto = await crearProducto(empresaId, cuentaId);
    let bodyCapturado: Record<string, unknown> | null = null;
    vi.stubGlobal("fetch", enrutarFetch(reglasBase({ onCrearItem: (body) => ((bodyCapturado = body), null) })));
    await publicarProductoEnCuentas(empresaId, producto.id);
    const attrs = bodyCapturado!.attributes as { id: string; value_name: string }[];
    expect(attrs.find((a) => a.id === "BRAND")?.value_name).toBe("Genérica");
  });

  it("Pack sin unidades reales falla ANTES de llamar a Mercado Libre (caso espejo, Mateo 25/9)", async () => {
    const { empresaId, cuentaId } = await crearEmpresaYCuenta(randomUUID().slice(0, 8));
    const producto = await crearProducto(empresaId, cuentaId, { atributosExtra: { SALE_FORMAT: "Pack" } });
    const fetchMock = enrutarFetch(reglasBase());
    vi.stubGlobal("fetch", fetchMock);
    const resultados = await publicarProductoEnCuentas(empresaId, producto.id);
    expect(resultados[0].ok).toBe(false);
    expect((resultados[0] as { error: string }).error).toContain("Pack");
    // No debió siquiera llegar a pedir la categoría — se corta temprano.
    expect(fetchMock.mock.calls.some((c) => String(c[0]).includes("domain_discovery"))).toBe(false);
  });

  it("family_name rechazado por la categoría ⇒ reintenta una vez con 'title' (16/9, FullyLemon/Débora)", async () => {
    const { empresaId, cuentaId } = await crearEmpresaYCuenta(randomUUID().slice(0, 8));
    const producto = await crearProducto(empresaId, cuentaId);
    let intento = 0;
    vi.stubGlobal(
      "fetch",
      enrutarFetch(
        reglasBase({
          onCrearItem: (body) => {
            intento += 1;
            if (intento === 1) {
              expect(body.family_name).toBeDefined();
              expect(body.title).toBeUndefined();
              return jsonRes(400, { message: "The field family name is invalid" });
            }
            expect(body.title).toBeDefined();
            expect(body.family_name).toBeUndefined();
            return null;
          },
        })
      )
    );
    const resultados = await publicarProductoEnCuentas(empresaId, producto.id);
    expect(resultados[0].ok).toBe(true);
    expect(intento).toBe(2);
  });

  it("caché de categoría compartido: dos cuentas con mismo sitio+título solo piden los atributos de categoría una vez", async () => {
    const { empresaId, cuentaId: cuentaA } = await crearEmpresaYCuenta(randomUUID().slice(0, 8));
    const [cuentaB] = await dbComoEmpresa(empresaId, (tx) =>
      tx
        .insert(cuentasMl)
        .values({
          empresaId,
          cuentaIdExterna: cuentaIdExternaDePrueba(),
          nickname: "VENDEDOR_B",
          accessTokenCifrado: cifrarToken("access"),
          refreshTokenCifrado: cifrarToken("refresh"),
          tokenExpiraTs: new Date(Date.now() + 3600_000),
        })
        .returning({ id: cuentasMl.id })
    );
    const producto = await crearProducto(empresaId, cuentaA, {
      cuentasSeleccionadas: [cuentaA, cuentaB.id],
      porCuenta: { [cuentaA]: { titulo: "Mismo título" }, [cuentaB.id]: { titulo: "Mismo título" } },
    });
    const fetchMock = enrutarFetch(reglasBase());
    vi.stubGlobal("fetch", fetchMock);
    const resultados = await publicarProductoEnCuentas(empresaId, producto.id);
    expect(resultados.filter((r) => r.ok)).toHaveLength(2);
    const llamadasAtributos = fetchMock.mock.calls.filter((c) => String(c[0]).includes("/categories/MCO1234/attributes"));
    expect(llamadasAtributos).toHaveLength(1);
  });

  it("una cuenta que falla nunca tumba a las demás (degradación por cuenta)", async () => {
    const { empresaId, cuentaId: cuentaA } = await crearEmpresaYCuenta(randomUUID().slice(0, 8));
    const [cuentaB] = await dbComoEmpresa(empresaId, (tx) =>
      tx
        .insert(cuentasMl)
        .values({
          empresaId,
          cuentaIdExterna: cuentaIdExternaDePrueba(),
          nickname: "VENDEDOR_SIN_TITULO",
          accessTokenCifrado: cifrarToken("access"),
          refreshTokenCifrado: cifrarToken("refresh"),
          tokenExpiraTs: new Date(Date.now() + 3600_000),
        })
        .returning({ id: cuentasMl.id })
    );
    // cuentaB nunca recibe título por-cuenta ni hay ningún registro de respaldo.
    const producto = await crearProducto(empresaId, cuentaA, { cuentasSeleccionadas: [cuentaA, cuentaB.id], porCuenta: {} });
    vi.stubGlobal("fetch", enrutarFetch(reglasBase()));
    const resultados = await publicarProductoEnCuentas(empresaId, producto.id);
    expect(resultados).toHaveLength(2);
    expect(resultados.every((r) => !r.ok)).toBe(true); // ninguna tenía título — ambas fallan, pero ninguna tumbó a la otra
  });
});

describe("publicarProductoEnCuentas — camino 'User Products' (variantes que no admiten variations clásico)", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("cae a publicar una familia (un ítem por combinación) cuando la categoría rechaza 'variations'", async () => {
    const { empresaId, cuentaId } = await crearEmpresaYCuenta(randomUUID().slice(0, 8));
    const producto = await crearProducto(empresaId, cuentaId, {
      variantes: {
        ejes: ["TALLA"],
        ejeFoto: null,
        combinaciones: [
          { valores: { TALLA: "S" }, sku: "SKU-S", stock: 5, precio: 50000 },
          { valores: { TALLA: "M" }, sku: "SKU-M", stock: 3, precio: 50000 },
        ],
      },
    });
    let primerIntento = true;
    vi.stubGlobal(
      "fetch",
      enrutarFetch(
        reglasBase({
          onCrearItem: (body) => {
            if (primerIntento && body.variations) {
              primerIntento = false;
              return jsonRes(400, { message: "variations field is invalid for this family" });
            }
            return null;
          },
        })
      )
    );
    const resultados = await publicarProductoEnCuentas(empresaId, producto.id);
    expect(resultados).toHaveLength(1);
    const r = resultados[0] as { ok: boolean; familia?: { familyName: string; items: { ok: boolean }[] } };
    expect(r.ok).toBe(true);
    expect(r.familia?.items).toHaveLength(2);
    expect(r.familia?.items.every((i) => i.ok)).toBe(true);
  });
});

describe("publicarProductoEnCuentas — dimensiones faltantes (Melissa, 22/9)", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("traduce 'missing.seller.package.dimensions' a un mensaje claro en español", async () => {
    const { empresaId, cuentaId } = await crearEmpresaYCuenta(randomUUID().slice(0, 8));
    const producto = await crearProducto(empresaId, cuentaId);
    vi.stubGlobal(
      "fetch",
      enrutarFetch(reglasBase({ onCrearItem: () => jsonRes(400, { message: "item.attribute.missing.seller.package.dimensions" }) }))
    );
    const resultados = await publicarProductoEnCuentas(empresaId, producto.id);
    expect((resultados[0] as { ok: boolean; error: string }).ok).toBe(false);
    expect((resultados[0] as { error: string }).error).toContain("Faltan las dimensiones del paquete");
  });
});
