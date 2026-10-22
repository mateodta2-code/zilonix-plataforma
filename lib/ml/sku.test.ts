import { randomUUID } from "crypto";
import { eq } from "drizzle-orm";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { db } from "@/db";
import { dbComoEmpresa } from "@/db/empresa-context";
import { cuentasMl, empresas, publicaciones, skus, usuarios } from "@/db/schema";
import { cifrarToken } from "@/lib/cifrado";
import { LARGO_MAXIMO_BUSQUEDA, normalizarParametro, PAGINA_MAXIMA } from "@/lib/filtros-listado";
import {
  crearSku,
  definirKit,
  KitSeContieneASiMismoError,
  listarPublicacionesSinSku,
  listarPublicacionesSinSkuFiltradas,
  listarSkus,
  listarSkusFiltrados,
  SkuCodigoDuplicadoError,
  vincularPublicacionASku,
} from "./sku";

// Tarea 2.6 — prueba real contra Postgres: el SKU maestro es único
// por empresa, el enlace con publicaciones respeta el aislamiento de
// siempre, y los kits no pueden contenerse a sí mismos.
describe("SKU maestro (tarea 2.6)", () => {
  const empresaAId = randomUUID();
  const empresaBId = randomUUID();
  const usuarioId = randomUUID();
  let publicacionId: string;

  // Contra la base real: CI es rápido (Postgres local), una corrida
  // manual contra staging por túnel SSH tiene latencia real.
  vi.setConfig({ testTimeout: 15_000 });

  beforeAll(async () => {
    await db.insert(usuarios).values({ id: usuarioId, email: `prueba-sku-${usuarioId.slice(0, 8)}@zilonix.test`, nombre: "Usuario de prueba 2.6" });
    await dbComoEmpresa(empresaAId, (tx) =>
      tx.insert(empresas).values({ id: empresaAId, nombre: "Empresa A (prueba 2.6)", nit: `TEST-SKUA-${empresaAId.slice(0, 8)}` })
    );
    await dbComoEmpresa(empresaBId, (tx) =>
      tx.insert(empresas).values({ id: empresaBId, nombre: "Empresa B (prueba 2.6)", nit: `TEST-SKUB-${empresaBId.slice(0, 8)}` })
    );

    const [cuenta] = await dbComoEmpresa(empresaAId, (tx) =>
      tx
        .insert(cuentasMl)
        .values({
          empresaId: empresaAId,
          cuentaIdExterna: `ml-user-sku-${randomUUID()}`,
          nickname: "VENDEDOR_SKU",
          accessTokenCifrado: cifrarToken("access"),
          refreshTokenCifrado: cifrarToken("refresh"),
          tokenExpiraTs: new Date(Date.now() + 3600_000),
        })
        .returning({ id: cuentasMl.id })
    );
    const [publicacion] = await dbComoEmpresa(empresaAId, (tx) =>
      tx
        .insert(publicaciones)
        .values({
          empresaId: empresaAId,
          cuentaMlId: cuenta.id,
          publicacionIdExterno: `MCO-${randomUUID()}`,
          titulo: "Camiseta azul talla M",
          precio: "50000",
          stock: 10,
        })
        .returning({ id: publicaciones.id })
    );
    publicacionId = publicacion.id;
  });

  it("crea un SKU y lo lista", async () => {
    const { id } = await crearSku(empresaAId, usuarioId, { codigo: "CAM-AZUL-M", nombre: "Camiseta Azul M", nombreBase: "Camiseta" });
    const lista = await listarSkus(empresaAId);
    expect(lista.find((s) => s.id === id)?.codigo).toBe("CAM-AZUL-M");
  });

  it("no deja crear dos SKUs con el mismo código en la misma empresa", async () => {
    await crearSku(empresaAId, usuarioId, { codigo: "DUPLICADO", nombre: "Uno" });
    await expect(crearSku(empresaAId, usuarioId, { codigo: "DUPLICADO", nombre: "Otro" })).rejects.toThrow(SkuCodigoDuplicadoError);
  });

  it("el mismo código SÍ se puede repetir en empresas distintas", async () => {
    await crearSku(empresaAId, usuarioId, { codigo: "COMPARTIDO", nombre: "De empresa A" });
    await expect(crearSku(empresaBId, usuarioId, { codigo: "COMPARTIDO", nombre: "De empresa B" })).resolves.toBeDefined();
  });

  it("empresa B nunca ve los SKUs de empresa A", async () => {
    const lista = await listarSkus(empresaBId);
    expect(lista.some((s) => s.codigo === "CAM-AZUL-M")).toBe(false);
  });

  it("vincula una publicación a un SKU y deja de aparecer en 'sin SKU'", async () => {
    const { id: skuId } = await crearSku(empresaAId, usuarioId, { codigo: "VINCULAR-TEST", nombre: "Para vincular" });
    const antes = await listarPublicacionesSinSku(empresaAId);
    expect(antes.some((p) => p.id === publicacionId)).toBe(true);

    await vincularPublicacionASku(empresaAId, usuarioId, publicacionId, skuId);

    const despues = await listarPublicacionesSinSku(empresaAId);
    expect(despues.some((p) => p.id === publicacionId)).toBe(false);

    const [fila] = await dbComoEmpresa(empresaAId, (tx) => tx.select().from(publicaciones).where(eq(publicaciones.id, publicacionId)));
    expect(fila.skuId).toBe(skuId);
  });

  it("no deja vincular a un SKU de otra empresa (no existe bajo el contexto de A)", async () => {
    const { id: skuDeB } = await crearSku(empresaBId, usuarioId, { codigo: "DE-OTRA-EMPRESA", nombre: "x" });
    await expect(vincularPublicacionASku(empresaAId, usuarioId, publicacionId, skuDeB)).rejects.toThrow();
  });

  it("define un kit con componentes reales", async () => {
    const { id: compA } = await crearSku(empresaAId, usuarioId, { codigo: "KIT-COMP-A", nombre: "Componente A" });
    const { id: compB } = await crearSku(empresaAId, usuarioId, { codigo: "KIT-COMP-B", nombre: "Componente B" });
    const { id: kitId } = await crearSku(empresaAId, usuarioId, { codigo: "KIT-COMBO", nombre: "Combo A+B" });

    await definirKit(empresaAId, usuarioId, kitId, [
      { skuComponenteId: compA, cantidad: 1 },
      { skuComponenteId: compB, cantidad: 2 },
    ]);

    const lista = await listarSkus(empresaAId);
    expect(lista.find((s) => s.id === kitId)?.esKit).toBe(true);
  });

  it("un kit no puede contenerse a sí mismo", async () => {
    const { id: kitId } = await crearSku(empresaAId, usuarioId, { codigo: "KIT-INVALIDO", nombre: "x" });
    await expect(definirKit(empresaAId, usuarioId, kitId, [{ skuComponenteId: kitId, cantidad: 1 }])).rejects.toThrow(
      KitSeContieneASiMismoError
    );
  });
});

// Issue "tabla completa de SKU" — prueba real contra Postgres de
// búsqueda (código Y nombre), filtro por tipo, orden, paginación y
// aislamiento de listarSkusFiltrados(). 30 SKUs insertados directo:
// código = SKU-00..SKU-29 (sube con i), nombre = "Nombre 29..00" (baja
// con i, a propósito INVERSO al código) salvo el i=15, cuyo nombre es
// "ZZZ-BUSCAME-ESPECIAL" (único, para la prueba de búsqueda por
// nombre — nunca aparece en ningún código).
describe("listarSkusFiltrados — búsqueda, filtro, orden, paginación y aislamiento", () => {
  vi.setConfig({ testTimeout: 20_000 });

  const empresaId = randomUUID();
  const empresaBId = randomUUID();
  const TOTAL_SKUS = 30;

  beforeAll(async () => {
    await dbComoEmpresa(empresaId, (tx) =>
      tx.insert(empresas).values({ id: empresaId, nombre: "Empresa filtros SKU", nit: `TEST-SKUF-${empresaId.slice(0, 8)}` })
    );
    await dbComoEmpresa(empresaBId, (tx) =>
      tx.insert(empresas).values({ id: empresaBId, nombre: "Empresa B filtros SKU", nit: `TEST-SKUFB-${empresaBId.slice(0, 8)}` })
    );

    const pad = (n: number) => String(n).padStart(2, "0");
    const filas = Array.from({ length: TOTAL_SKUS }, (_, i) => ({
      empresaId,
      codigo: `SKU-${pad(i)}`,
      nombre: i === 15 ? "ZZZ-BUSCAME-ESPECIAL" : `Nombre ${pad(TOTAL_SKUS - 1 - i)}`,
      esKit: i === 20,
    }));
    await dbComoEmpresa(empresaId, (tx) => tx.insert(skus).values(filas));

    // Empresa B: un SKU con el MISMO código que el especial de A — la
    // prueba de aislamiento confirma que buscarlo bajo el contexto de A
    // nunca trae el de B.
    await dbComoEmpresa(empresaBId, (tx) =>
      tx.insert(skus).values({ empresaId: empresaBId, codigo: "BUSCAME-ESPECIAL", nombre: "SKU de empresa B" })
    );
  });

  it("sin filtros: trae la primera página (25) ordenada por código ascendente por defecto", async () => {
    const resultado = await listarSkusFiltrados(empresaId);
    expect(resultado.total).toBe(TOTAL_SKUS);
    expect(resultado.totalPaginas).toBe(2);
    expect(resultado.pagina).toBe(1);
    expect(resultado.skus).toHaveLength(25);
    expect(resultado.skus[0].codigo).toBe("SKU-00");
  });

  it("página 2 trae el resto (5)", async () => {
    const resultado = await listarSkusFiltrados(empresaId, { pagina: 2 });
    expect(resultado.skus).toHaveLength(5);
    expect(resultado.pagina).toBe(2);
  });

  it(`página fuera de [1, ${PAGINA_MAXIMA}] (0, negativa, decimal, > ${PAGINA_MAXIMA}) se trata como 1`, async () => {
    for (const paginaInvalida of [0, -5, 1.5, PAGINA_MAXIMA + 1]) {
      const resultado = await listarSkusFiltrados(empresaId, { pagina: paginaInvalida });
      expect(resultado.pagina).toBe(1);
    }
  });

  it("1e20 no es un entero seguro: vuelve a la página 1, sin tirar", async () => {
    const resultado = await listarSkusFiltrados(empresaId, { pagina: 1e20 });
    expect(resultado.pagina).toBe(1);
  });

  it("una página dentro de rango pero mayor que el total real se recorta al total de páginas", async () => {
    const resultado = await listarSkusFiltrados(empresaId, { pagina: 9999 });
    expect(resultado.pagina).toBe(resultado.totalPaginas);
    expect(resultado.skus.length).toBeGreaterThan(0);
  });

  it("búsqueda por código", async () => {
    const resultado = await listarSkusFiltrados(empresaId, { busqueda: "SKU-05" });
    expect(resultado.total).toBe(1);
    expect(resultado.skus[0].codigo).toBe("SKU-05");
  });

  it("búsqueda por nombre cuando el código no coincide (usa OR entre los dos campos)", async () => {
    const resultado = await listarSkusFiltrados(empresaId, { busqueda: "buscame" });
    expect(resultado.total).toBe(1);
    expect(resultado.skus[0].codigo).toBe("SKU-15");
  });

  it("un % suelto no es un comodín: no matchea ningún SKU", async () => {
    const resultado = await listarSkusFiltrados(empresaId, { busqueda: "%" });
    expect(resultado.total).toBe(0);
  });

  it("un _ suelto no es un comodín de un solo carácter: 'SKU_05' no encuentra 'SKU-05'", async () => {
    const resultado = await listarSkusFiltrados(empresaId, { busqueda: "SKU_05" });
    expect(resultado.total).toBe(0);
  });

  it(`una búsqueda de 5000 caracteres se recorta a ${LARGO_MAXIMO_BUSQUEDA} y no revienta`, async () => {
    const resultado = await listarSkusFiltrados(empresaId, { busqueda: "a".repeat(5000) });
    expect(resultado.total).toBe(0);
  });

  it("un parámetro repetido en la URL (arreglo) nunca revienta: se normaliza al primer valor antes de filtrar", async () => {
    const resultado = await listarSkusFiltrados(empresaId, { busqueda: normalizarParametro(["SKU-05", "otro-valor"]) });
    expect(resultado.total).toBe(1);
    expect(resultado.skus[0].codigo).toBe("SKU-05");
  });

  it("filtro estado=kit solo trae los que son kit", async () => {
    const resultado = await listarSkusFiltrados(empresaId, { estado: "kit" });
    expect(resultado.total).toBe(1);
    expect(resultado.skus[0].codigo).toBe("SKU-20");
  });

  it("filtro estado=simple trae el resto", async () => {
    const resultado = await listarSkusFiltrados(empresaId, { estado: "simple" });
    expect(resultado.total).toBe(TOTAL_SKUS - 1);
  });

  it("un ?estado= fuera de la lista permitida se ignora", async () => {
    const resultado = await listarSkusFiltrados(empresaId, { estado: "estado-que-no-existe" });
    expect(resultado.total).toBe(TOTAL_SKUS);
  });

  it("un ?orden= fuera de la lista permitida se ignora y usa codigo_asc por defecto", async () => {
    const resultado = await listarSkusFiltrados(empresaId, { orden: "orden-que-no-existe" });
    expect(resultado.skus[0].codigo).toBe("SKU-00");
  });

  it("orden=nombre_asc ordena por nombre, no por código (son inversos en esta prueba)", async () => {
    const resultado = await listarSkusFiltrados(empresaId, { orden: "nombre_asc" });
    expect(resultado.skus[0].codigo).toBe("SKU-29"); // nombre "Nombre 00", el más chico alfabéticamente
  });

  it("aislamiento A/B: buscar el mismo texto nunca mezcla los SKU de la otra empresa", async () => {
    // A lo tiene en el NOMBRE (SKU-15, "ZZZ-BUSCAME-ESPECIAL") y B lo
    // tiene en el CÓDIGO ("BUSCAME-ESPECIAL") — las dos coinciden con
    // el mismo texto buscado, pero cada una debe ver solo la suya.
    const [deA, deB] = await Promise.all([
      listarSkusFiltrados(empresaId, { busqueda: "BUSCAME-ESPECIAL" }),
      listarSkusFiltrados(empresaBId, { busqueda: "BUSCAME-ESPECIAL" }),
    ]);
    expect(deA.total).toBe(1);
    expect(deA.skus[0].codigo).toBe("SKU-15");
    expect(deA.skus[0].empresaId).toBe(empresaId);
    expect(deB.total).toBe(1);
    expect(deB.skus[0].codigo).toBe("BUSCAME-ESPECIAL");
    expect(deB.skus[0].empresaId).toBe(empresaBId);
  });

  it("aislamiento A/B por nombre: el texto especial de A nunca aparece bajo el contexto de B", async () => {
    const resultado = await listarSkusFiltrados(empresaBId, { busqueda: "ZZZ" });
    expect(resultado.total).toBe(0);
  });

  it("RLS por sí solo (sin ningún WHERE de empresaId en el código de la prueba) ya aísla: empresa B nunca ve los 30 SKU de A", async () => {
    // A propósito, sin eq(skus.empresaId, ...) ni ninguna otra condición
    // — si esto alguna vez devolviera una fila de A, la política de RLS
    // de la tabla (no el código de la app) estaría rota.
    const filasBajoB = await dbComoEmpresa(empresaBId, (tx) => tx.select().from(skus));
    expect(filasBajoB.every((f) => f.empresaId === empresaBId)).toBe(true);
    expect(filasBajoB.some((f) => f.codigo.startsWith("SKU-"))).toBe(false);
  });
});

// Issue "tabla completa de SKU" — prueba real contra Postgres de
// búsqueda (título Y id de publicación de ML), orden, paginación y
// aislamiento de listarPublicacionesSinSkuFiltradas(). 30 publicaciones
// sin SKU insertadas directo: importado_ts = 1..30 de enero de 2026
// (sube con i); título = "Producto 29..00" (baja con i, inverso al
// importado_ts) salvo el i=15 ("ZZZ-BUSCAME-POR-TITULO", búsqueda por
// título); el i=7 tiene un publicacionIdExterno único
// ("BUSCAME-POR-ID", búsqueda por id de publicación).
describe("listarPublicacionesSinSkuFiltradas — búsqueda, orden, paginación y aislamiento", () => {
  vi.setConfig({ testTimeout: 20_000 });

  const empresaId = randomUUID();
  const empresaBId = randomUUID();
  const TOTAL_PUBLICACIONES = 30;

  beforeAll(async () => {
    await dbComoEmpresa(empresaId, (tx) =>
      tx.insert(empresas).values({ id: empresaId, nombre: "Empresa filtros sin-SKU", nit: `TEST-SVF-${empresaId.slice(0, 8)}` })
    );
    await dbComoEmpresa(empresaBId, (tx) =>
      tx.insert(empresas).values({ id: empresaBId, nombre: "Empresa B filtros sin-SKU", nit: `TEST-SVFB-${empresaBId.slice(0, 8)}` })
    );

    const [cuenta] = await dbComoEmpresa(empresaId, (tx) =>
      tx
        .insert(cuentasMl)
        .values({
          empresaId,
          cuentaIdExterna: `ml-user-svf-${randomUUID()}`,
          nickname: "VENDEDOR_SVF",
          accessTokenCifrado: cifrarToken("access"),
          refreshTokenCifrado: cifrarToken("refresh"),
          tokenExpiraTs: new Date(Date.now() + 3600_000),
        })
        .returning({ id: cuentasMl.id })
    );
    const [cuentaB] = await dbComoEmpresa(empresaBId, (tx) =>
      tx
        .insert(cuentasMl)
        .values({
          empresaId: empresaBId,
          cuentaIdExterna: `ml-user-svfb-${randomUUID()}`,
          nickname: "VENDEDOR_SVFB",
          accessTokenCifrado: cifrarToken("access-b"),
          refreshTokenCifrado: cifrarToken("refresh-b"),
          tokenExpiraTs: new Date(Date.now() + 3600_000),
        })
        .returning({ id: cuentasMl.id })
    );

    const pad = (n: number) => String(n).padStart(2, "0");
    const filas = Array.from({ length: TOTAL_PUBLICACIONES }, (_, i) => ({
      empresaId,
      cuentaMlId: cuenta.id,
      publicacionIdExterno: i === 7 ? "BUSCAME-POR-ID" : `MCO-${pad(i)}`,
      titulo: i === 15 ? "ZZZ-BUSCAME-POR-TITULO" : `Producto ${pad(TOTAL_PUBLICACIONES - 1 - i)}`,
      precio: "10000",
      stock: 5,
      importadoTs: new Date(Date.UTC(2026, 0, i + 1, 12, 0, 0)),
    }));
    await dbComoEmpresa(empresaId, (tx) => tx.insert(publicaciones).values(filas));

    // Empresa B: una publicación con el MISMO publicacionIdExterno que
    // la especial de A — confirma que buscarlo bajo A nunca trae la de B.
    await dbComoEmpresa(empresaBId, (tx) =>
      tx.insert(publicaciones).values({
        empresaId: empresaBId,
        cuentaMlId: cuentaB.id,
        publicacionIdExterno: "BUSCAME-POR-ID",
        titulo: "Publicación de empresa B",
        precio: "5000",
        stock: 1,
      })
    );
  });

  it("sin filtros: trae la primera página (25) ordenada por importado_ts descendente por defecto", async () => {
    const resultado = await listarPublicacionesSinSkuFiltradas(empresaId);
    expect(resultado.total).toBe(TOTAL_PUBLICACIONES);
    expect(resultado.totalPaginas).toBe(2);
    expect(resultado.pagina).toBe(1);
    expect(resultado.publicaciones).toHaveLength(25);
    expect(resultado.publicaciones[0].publicacionIdExterno).toBe("MCO-29"); // la más reciente
  });

  it("página 2 trae el resto (5)", async () => {
    const resultado = await listarPublicacionesSinSkuFiltradas(empresaId, { pagina: 2 });
    expect(resultado.publicaciones).toHaveLength(5);
    expect(resultado.pagina).toBe(2);
  });

  it(`página fuera de [1, ${PAGINA_MAXIMA}] se trata como 1`, async () => {
    for (const paginaInvalida of [0, -5, 1.5, PAGINA_MAXIMA + 1]) {
      const resultado = await listarPublicacionesSinSkuFiltradas(empresaId, { pagina: paginaInvalida });
      expect(resultado.pagina).toBe(1);
    }
  });

  it("una página dentro de rango pero mayor que el total real se recorta al total de páginas", async () => {
    const resultado = await listarPublicacionesSinSkuFiltradas(empresaId, { pagina: 9999 });
    expect(resultado.pagina).toBe(resultado.totalPaginas);
  });

  it("búsqueda por título", async () => {
    const resultado = await listarPublicacionesSinSkuFiltradas(empresaId, { busqueda: "zzz-buscame-por-titulo" });
    expect(resultado.total).toBe(1);
    expect(resultado.publicaciones[0].publicacionIdExterno).toBe("MCO-15");
  });

  it("búsqueda por id de publicación de Mercado Libre cuando el título no coincide (usa OR entre los dos campos)", async () => {
    const resultado = await listarPublicacionesSinSkuFiltradas(empresaId, { busqueda: "buscame-por-id" });
    expect(resultado.total).toBe(1);
    expect(resultado.publicaciones[0].publicacionIdExterno).toBe("BUSCAME-POR-ID");
  });

  it("un % suelto no es un comodín: no matchea ninguna publicación", async () => {
    const resultado = await listarPublicacionesSinSkuFiltradas(empresaId, { busqueda: "%" });
    expect(resultado.total).toBe(0);
  });

  it("un _ suelto no es un comodín de un solo carácter: 'MCO_00' no encuentra 'MCO-00'", async () => {
    const resultado = await listarPublicacionesSinSkuFiltradas(empresaId, { busqueda: "MCO_00" });
    expect(resultado.total).toBe(0);
  });

  it("un parámetro repetido en la URL (arreglo) nunca revienta", async () => {
    const resultado = await listarPublicacionesSinSkuFiltradas(empresaId, {
      busqueda: normalizarParametro(["BUSCAME-POR-ID", "otro-valor"]),
    });
    expect(resultado.total).toBe(1);
  });

  it("un ?orden= fuera de la lista permitida se ignora y usa importado_desc por defecto", async () => {
    const resultado = await listarPublicacionesSinSkuFiltradas(empresaId, { orden: "orden-que-no-existe" });
    expect(resultado.publicaciones[0].publicacionIdExterno).toBe("MCO-29");
  });

  it("orden=titulo_asc ordena por título, no por fecha de importación (son inversos en esta prueba)", async () => {
    const resultado = await listarPublicacionesSinSkuFiltradas(empresaId, { orden: "titulo_asc" });
    expect(resultado.publicaciones[0].publicacionIdExterno).toBe("MCO-29"); // título "Producto 00", el más chico alfabéticamente
  });

  it("aislamiento A/B: buscar el mismo id de publicación nunca mezcla las publicaciones de la otra empresa", async () => {
    const [deA, deB] = await Promise.all([
      listarPublicacionesSinSkuFiltradas(empresaId, { busqueda: "BUSCAME-POR-ID" }),
      listarPublicacionesSinSkuFiltradas(empresaBId, { busqueda: "BUSCAME-POR-ID" }),
    ]);
    expect(deA.total).toBe(1);
    expect(deB.total).toBe(1);
  });

  it("RLS por sí solo (sin ningún WHERE de empresaId en el código de la prueba) ya aísla: empresa B nunca ve las 30 publicaciones de A", async () => {
    const filasBajoB = await dbComoEmpresa(empresaBId, (tx) => tx.select().from(publicaciones));
    expect(filasBajoB.every((f) => f.empresaId === empresaBId)).toBe(true);
    expect(filasBajoB.some((f) => f.publicacionIdExterno.startsWith("MCO-"))).toBe(false);
  });
});
