import { randomUUID } from "crypto";
import { eq } from "drizzle-orm";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { dbComoEmpresa } from "@/db/empresa-context";
import { auditoria, cuentasMl, empresas, productosMl, publicaciones } from "@/db/schema";
import { cifrarToken } from "@/lib/cifrado";
import { publicarProductoEnCuentas } from "./publicar";

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
    [/\/users\/ml-user-/, () => jsonRes(200, { site_id: "MCO" })],
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

async function crearEmpresaYCuenta(sufijo: string) {
  const empresaId = randomUUID();
  await dbComoEmpresa(empresaId, (tx) => tx.insert(empresas).values({ id: empresaId, nombre: `Empresa publicar ${sufijo}`, nit: `TEST-PUB-${sufijo}` }));
  const [cuenta] = await dbComoEmpresa(empresaId, (tx) =>
    tx
      .insert(cuentasMl)
      .values({
        empresaId,
        cuentaIdExterna: `ml-user-${sufijo}`,
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

  it("empresa B nunca ve los productos de empresa A (aislamiento RLS)", async () => {
    const { empresaId, cuentaId } = await crearEmpresaYCuenta(randomUUID().slice(0, 8));
    const { empresaId: empresaB } = await crearEmpresaYCuenta(randomUUID().slice(0, 8));
    await crearProducto(empresaId, cuentaId);
    const vistosDesdeB = await dbComoEmpresa(empresaB, (tx) => tx.select().from(productosMl));
    expect(vistosDesdeB).toHaveLength(0);
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
          cuentaIdExterna: `ml-user-${randomUUID().slice(0, 8)}`,
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
          cuentaIdExterna: `ml-user-${randomUUID().slice(0, 8)}`,
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
