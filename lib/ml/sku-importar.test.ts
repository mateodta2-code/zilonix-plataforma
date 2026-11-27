import { randomUUID } from "crypto";
import { and, eq } from "drizzle-orm";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { db } from "@/db";
import { dbComoEmpresa } from "@/db/empresa-context";
import { bodegas, empresas, kardexMovimientos, membresias, permisosRol, roles, skus, stockBodega, usuarios } from "@/db/schema";
import * as auditoriaModule from "@/lib/auditoria";
import * as movimientosModule from "@/lib/inventario/movimientos";
import { SinPermisoError } from "@/lib/permisos";
import { confirmarImportacionSkus, previsualizarImportacionSkus, SinFilasValidasError } from "./sku-importar";

// Issue #58 (Z-ML-09) — prueba real contra Postgres: lib/ml/sku-importar.ts
// es la primera función de lib/ml/ que llama requierePermiso() por su
// cuenta (a pedido explícito de la tarea), así que acá SÍ hace falta
// armar un rol y una membresía reales — el resto de lib/ml/*.test.ts
// nunca lo necesitó porque el permiso vivía en la página, no en la
// función.
async function crearEmpresaConPermiso(nombre: string, modulo: string, accion: "consultar" | "crear" | "modificar" | "anular" | "autorizar") {
  const empresaId = randomUUID();
  const usuarioId = randomUUID();
  const rolId = randomUUID();

  await dbComoEmpresa(empresaId, (tx) => tx.insert(empresas).values({ id: empresaId, nombre, nit: `TEST-IMP-${empresaId.slice(0, 8)}` }));
  await db.insert(usuarios).values({ id: usuarioId, email: `prueba-imp-${usuarioId.slice(0, 8)}@zilonix.test`, nombre: `Usuario ${nombre}` });
  await dbComoEmpresa(empresaId, async (tx) => {
    await tx.insert(roles).values({ id: rolId, nombre: "Rol de prueba", empresaId });
    await tx.insert(permisosRol).values({ rolId, modulo, accion });
    await tx.insert(membresias).values({ usuarioId, empresaId, rolId });
  });

  return { empresaId, usuarioId };
}

async function crearBodega(empresaId: string, nombre: string, opciones: { esPrincipal?: boolean; activa?: boolean } = {}): Promise<string> {
  const [fila] = await dbComoEmpresa(empresaId, (tx) =>
    tx
      .insert(bodegas)
      .values({ empresaId, nombre, esPrincipal: opciones.esPrincipal ?? false, activa: opciones.activa ?? true })
      .returning({ id: bodegas.id })
  );
  return fila.id;
}

async function idDeSku(empresaId: string, codigo: string): Promise<string | undefined> {
  const [fila] = await dbComoEmpresa(empresaId, (tx) =>
    tx.select({ id: skus.id }).from(skus).where(and(eq(skus.empresaId, empresaId), eq(skus.codigo, codigo)))
  );
  return fila?.id;
}

async function stockDe(empresaId: string, skuId: string) {
  return dbComoEmpresa(empresaId, (tx) =>
    tx.select({ bodegaId: stockBodega.bodegaId, disponible: stockBodega.disponible }).from(stockBodega).where(eq(stockBodega.skuId, skuId))
  );
}

async function kardexDe(empresaId: string, skuId: string) {
  return dbComoEmpresa(empresaId, (tx) => tx.select().from(kardexMovimientos).where(eq(kardexMovimientos.skuId, skuId)));
}

function csvDe(filas: string[]): string {
  return ["sku,nombre,bodega,cantidad_inicial", ...filas].join("\n");
}

describe("importación de SKUs desde CSV (issue #58, Z-ML-09)", () => {
  vi.setConfig({ testTimeout: 20_000 });

  let empresaAId: string;
  let usuarioAId: string;
  let empresaBId: string;
  let usuarioBId: string;
  let usuarioSinPermisoId: string;
  let principalAId: string;
  let norteAId: string;

  beforeAll(async () => {
    const a = await crearEmpresaConPermiso("Empresa A importar CSV", "inventario", "modificar");
    empresaAId = a.empresaId;
    usuarioAId = a.usuarioId;

    const b = await crearEmpresaConPermiso("Empresa B importar CSV", "inventario", "modificar");
    empresaBId = b.empresaId;
    usuarioBId = b.usuarioId;

    // Desde que el CSV carga stock (cantidad > 0 sin bodega va a la
    // principal), cada empresa de prueba necesita su bodega principal.
    principalAId = await crearBodega(empresaAId, "Bodega Principal", { esPrincipal: true });
    norteAId = await crearBodega(empresaAId, "Bodega Norte");
    await crearBodega(empresaAId, "Bodega Cerrada", { activa: false });
    await crearBodega(empresaBId, "Principal B", { esPrincipal: true });

    usuarioSinPermisoId = randomUUID();
    await db.insert(usuarios).values({ id: usuarioSinPermisoId, email: `prueba-sinpermiso-${usuarioSinPermisoId.slice(0, 8)}@zilonix.test`, nombre: "Usuario sin permiso" });
    // A propósito, SIN ninguna fila de membresías para este usuario en
    // empresaAId — obtenerMiMembresia() da null y requierePermiso()
    // tira SinPermisoError, sin necesidad de armar un rol vacío.
  });

  it("vista previa: separa nuevos de los que ya existen", async () => {
    await dbComoEmpresa(empresaAId, (tx) => tx.insert(skus).values({ empresaId: empresaAId, codigo: "PREVIA-EXISTENTE", nombre: "Ya estaba" }));

    const csv = csvDe(["PREVIA-NUEVO,Producto nuevo,Bodega Principal,5", "PREVIA-EXISTENTE,Nombre actualizado,,10"]);
    const vista = await previsualizarImportacionSkus(empresaAId, usuarioAId, csv);

    expect(vista.resumen.nuevos).toBe(1);
    expect(vista.resumen.existentes).toBe(1);
    expect(vista.filas.find((f) => f.sku === "PREVIA-NUEVO")?.yaExiste).toBe(false);
    expect(vista.filas.find((f) => f.sku === "PREVIA-EXISTENTE")?.yaExiste).toBe(true);
  });

  it("importación correcta: crea los SKUs nuevos de verdad en la base", async () => {
    const csv = csvDe(["OK-1,Camiseta azul,Bodega Principal,25", "OK-2,Gorra negra,,10"]);
    const resultado = await confirmarImportacionSkus(empresaAId, usuarioAId, csv);

    expect(resultado.creados).toBe(2);
    expect(resultado.actualizados).toBe(0);
    expect(resultado.omitidosPorError).toBe(0);

    const filas = await dbComoEmpresa(empresaAId, (tx) => tx.select().from(skus).where(eq(skus.empresaId, empresaAId)));
    expect(filas.find((f) => f.codigo === "OK-1")?.nombre).toBe("Camiseta azul");
    expect(filas.find((f) => f.codigo === "OK-2")?.nombre).toBe("Gorra negra");
  });

  it("una fila sin nombre usa el código como nombre (nunca uno inventado)", async () => {
    const csv = csvDe(["SIN-NOMBRE-1,,,3"]);
    await confirmarImportacionSkus(empresaAId, usuarioAId, csv);

    const [fila] = await dbComoEmpresa(empresaAId, (tx) => tx.select().from(skus).where(eq(skus.codigo, "SIN-NOMBRE-1")));
    expect(fila.nombre).toBe("SIN-NOMBRE-1");
  });

  it("archivo con errores: las filas inválidas se omiten, las válidas sí se importan", async () => {
    const csv = csvDe([
      "ERR-OK-1,Producto válido,,5",
      ",Sin código,,5", // sku vacío -> error
      "ERR-OK-2,Otro válido,,-1", // cantidad inválida en texto, pero el sku es otro campo — ver siguiente fila
    ]);
    // La tercera fila de arriba tiene cantidad "-1", que el patrón de
    // entero no negativo rechaza — ERR-OK-2 queda con error, no se
    // importa. Solo ERR-OK-1 debería crearse.
    const vista = await previsualizarImportacionSkus(empresaAId, usuarioAId, csv);
    expect(vista.resumen.validas).toBe(1);
    expect(vista.resumen.conError).toBe(2);

    const resultado = await confirmarImportacionSkus(empresaAId, usuarioAId, csv);
    expect(resultado.creados).toBe(1);
    expect(resultado.omitidosPorError).toBe(2);

    const existeOk = await dbComoEmpresa(empresaAId, (tx) => tx.select().from(skus).where(eq(skus.codigo, "ERR-OK-1")));
    expect(existeOk).toHaveLength(1);
    const existeMalo = await dbComoEmpresa(empresaAId, (tx) => tx.select().from(skus).where(eq(skus.codigo, "ERR-OK-2")));
    expect(existeMalo).toHaveLength(0);
  });

  it("código duplicado DENTRO del archivo: ninguna de las dos filas se importa", async () => {
    const csv = csvDe(["DUP-1,Primera vez,,1", "DUP-1,Segunda vez,,2"]);
    const vista = await previsualizarImportacionSkus(empresaAId, usuarioAId, csv);
    expect(vista.resumen.skusRepetidos).toEqual(["DUP-1"]);
    expect(vista.filas).toHaveLength(0);

    // Las dos únicas filas del archivo quedan con error (sku repetido)
    // — no hay NINGUNA fila válida, así que confirmar tira
    // SinFilasValidasError (nada que confirmar), nunca crea algo.
    await expect(confirmarImportacionSkus(empresaAId, usuarioAId, csv)).rejects.toThrow(SinFilasValidasError);

    const fila = await dbComoEmpresa(empresaAId, (tx) => tx.select().from(skus).where(eq(skus.codigo, "DUP-1")));
    expect(fila).toHaveLength(0);
  });

  it("código que ya existe: el issue dice 'crea o actualiza' — actualiza el nombre, nunca crea uno nuevo ni lo borra", async () => {
    await dbComoEmpresa(empresaAId, (tx) => tx.insert(skus).values({ empresaId: empresaAId, codigo: "YA-EXISTE-1", nombre: "Nombre viejo" }));

    const csv = csvDe(["YA-EXISTE-1,Nombre nuevo,,7"]);
    const resultado = await confirmarImportacionSkus(empresaAId, usuarioAId, csv);
    expect(resultado.creados).toBe(0);
    expect(resultado.actualizados).toBe(1);

    const filas = await dbComoEmpresa(empresaAId, (tx) => tx.select().from(skus).where(eq(skus.codigo, "YA-EXISTE-1")));
    expect(filas).toHaveLength(1); // nunca se duplicó
    expect(filas[0].nombre).toBe("Nombre nuevo");
  });

  it("código existente sin nombre en el CSV: se deja el nombre como estaba (no se actualiza a vacío) y cuenta como 'sinCambios', no 'actualizados'", async () => {
    await dbComoEmpresa(empresaAId, (tx) => tx.insert(skus).values({ empresaId: empresaAId, codigo: "YA-EXISTE-2", nombre: "Nombre que se queda" }));

    const csv = csvDe(["YA-EXISTE-2,,,0"]);
    const resultado = await confirmarImportacionSkus(empresaAId, usuarioAId, csv);
    expect(resultado.creados).toBe(0);
    expect(resultado.actualizados).toBe(0);
    expect(resultado.sinCambios).toBe(1);

    const [fila] = await dbComoEmpresa(empresaAId, (tx) => tx.select().from(skus).where(eq(skus.codigo, "YA-EXISTE-2")));
    expect(fila.nombre).toBe("Nombre que se queda");
  });

  // Ahora cada SKU nuevo con cantidad > 0 deja su movimiento de kardex
  // (~1176 de las 1200 filas): más tiempo que el resto de pruebas.
  it("un archivo de 1200 filas (más de 2 lotes de 500) entra completo", { timeout: 120_000 }, async () => {
    const TOTAL = 1200;
    const filas = Array.from({ length: TOTAL }, (_, i) => `LOTE-${String(i).padStart(4, "0")},Producto ${i},,${i % 50}`);
    const csv = csvDe(filas);

    const vista = await previsualizarImportacionSkus(empresaAId, usuarioAId, csv);
    expect(vista.resumen.validas).toBe(TOTAL);

    const resultado = await confirmarImportacionSkus(empresaAId, usuarioAId, csv);
    expect(resultado.creados).toBe(TOTAL);
    expect(resultado.actualizados + resultado.sinCambios + resultado.omitidosPorError).toBe(0);

    const guardadas = await dbComoEmpresa(empresaAId, (tx) =>
      tx.select({ codigo: skus.codigo }).from(skus).where(eq(skus.empresaId, empresaAId))
    );
    const codigosGuardados = new Set(guardadas.map((f) => f.codigo));
    // Puntos justo en el borde de un lote de 500 (índices 0, 499, 500,
    // 999, 1000 y el último) — si la división en lotes tuviera un
    // error de "uno de más/uno de menos", se notaría acá primero.
    for (const i of [0, 499, 500, 999, 1000, TOTAL - 1]) {
      expect(codigosGuardados.has(`LOTE-${String(i).padStart(4, "0")}`)).toBe(true);
    }
    expect(codigosGuardados.size).toBeGreaterThanOrEqual(TOTAL); // puede haber más de corridas previas en la misma empresa
  });

  it("un fallo real a mitad de la importación no deja nada a medias (todo o nada)", async () => {
    // Un código de 3000 caracteres (lo que probaba antes el caso de
    // "tamaño máximo de una fila de índice btree") no siempre hace
    // fallar a Postgres — confirmado contra Postgres real en CI, la
    // promesa resolvía igual. registrarAuditoria() corre al final,
    // DENTRO de la misma transacción que los inserts — forzar que
    // falle ahí adentro es un error real y determinístico (no depende
    // de ningún límite interno de Postgres) y prueba lo mismo: si la
    // transacción no fuera atómica, las dos filas de abajo quedarían
    // creadas igual, aunque el resto de confirmarImportacionSkus()
    // reviente después.
    const csv = csvDe(["ATOM-OK-1,Primero,,1", "ATOM-OK-2,Segundo,,1"]);
    const spy = vi.spyOn(auditoriaModule, "registrarAuditoria").mockRejectedValueOnce(new Error("Fallo simulado de auditoría"));
    try {
      await expect(confirmarImportacionSkus(empresaAId, usuarioAId, csv)).rejects.toThrow("Fallo simulado de auditoría");
    } finally {
      spy.mockRestore();
    }

    const fila1 = await dbComoEmpresa(empresaAId, (tx) => tx.select().from(skus).where(eq(skus.codigo, "ATOM-OK-1")));
    const fila2 = await dbComoEmpresa(empresaAId, (tx) => tx.select().from(skus).where(eq(skus.codigo, "ATOM-OK-2")));
    expect(fila1).toHaveLength(0);
    expect(fila2).toHaveLength(0);

    // El spy se restauró — una importación normal después sigue
    // funcionando (confirma que no quedó "roto" para el resto de la
    // corrida de pruebas).
    const resultado = await confirmarImportacionSkus(empresaAId, usuarioAId, csv);
    expect(resultado.creados).toBe(2);
  });

  it("sin permiso: ni la vista previa ni la confirmación dejan pasar a quien no tiene membresía en la empresa", async () => {
    const csv = csvDe(["SIN-PERMISO-1,x,,1"]);
    await expect(previsualizarImportacionSkus(empresaAId, usuarioSinPermisoId, csv)).rejects.toThrow(SinPermisoError);
    await expect(confirmarImportacionSkus(empresaAId, usuarioSinPermisoId, csv)).rejects.toThrow(SinPermisoError);

    const fila = await dbComoEmpresa(empresaAId, (tx) => tx.select().from(skus).where(eq(skus.codigo, "SIN-PERMISO-1")));
    expect(fila).toHaveLength(0);
  });

  it("confirmar sin ninguna fila válida tira SinFilasValidasError, sin escribir nada", async () => {
    const csv = csvDe([",Sin código,,1"]);
    await expect(confirmarImportacionSkus(empresaAId, usuarioAId, csv)).rejects.toThrow(SinFilasValidasError);
  });

  it("aislamiento A/B: importar el mismo código en dos empresas crea dos filas separadas, nunca se pisan", async () => {
    const csv = csvDe(["COMPARTIDO-AB,Nombre de A,,1"]);
    await confirmarImportacionSkus(empresaAId, usuarioAId, csv);
    await confirmarImportacionSkus(empresaBId, usuarioBId, csvDe(["COMPARTIDO-AB,Nombre de B,,1"]));

    const deA = await dbComoEmpresa(empresaAId, (tx) => tx.select().from(skus).where(eq(skus.codigo, "COMPARTIDO-AB")));
    const deB = await dbComoEmpresa(empresaBId, (tx) => tx.select().from(skus).where(eq(skus.codigo, "COMPARTIDO-AB")));
    expect(deA).toHaveLength(1);
    expect(deB).toHaveLength(1);
    expect(deA[0].nombre).toBe("Nombre de A");
    expect(deB[0].nombre).toBe("Nombre de B");
  });

  it("aislamiento A/B: empresa B nunca ve en su vista previa un código que solo existe en A", async () => {
    await dbComoEmpresa(empresaAId, (tx) => tx.insert(skus).values({ empresaId: empresaAId, codigo: "SOLO-EN-A", nombre: "x" }));

    const vista = await previsualizarImportacionSkus(empresaBId, usuarioBId, csvDe(["SOLO-EN-A,algo,,1"]));
    expect(vista.filas[0].yaExiste).toBe(false); // para B, ese código es nuevo — no existe en SU empresa
  });

  it("aislamiento A/B: confirmar en B nunca actualiza la fila de A con el mismo código", async () => {
    await confirmarImportacionSkus(empresaBId, usuarioBId, csvDe(["SOLO-EN-A,Pisado por B (no debería),,1"]));

    const [filaDeA] = await dbComoEmpresa(empresaAId, (tx) => tx.select().from(skus).where(eq(skus.codigo, "SOLO-EN-A")));
    expect(filaDeA.nombre).toBe("x"); // sigue igual, B nunca la tocó
  });

  describe("stock inicial en el kardex", () => {
    it("SKU nuevo con 10 y bodega vacía: 10 en la principal y una fila de kardex entrada/manual", async () => {
      const resultado = await confirmarImportacionSkus(empresaAId, usuarioAId, csvDe(["STK-PRINCIPAL,Producto,,10"]));
      expect(resultado.stockCargado).toBe(1);
      expect(resultado.unidadesCargadas).toBe(10);

      const skuId = (await idDeSku(empresaAId, "STK-PRINCIPAL"))!;
      expect(await stockDe(empresaAId, skuId)).toEqual([{ bodegaId: principalAId, disponible: 10 }]);
      const kardex = await kardexDe(empresaAId, skuId);
      expect(kardex).toHaveLength(1);
      expect(kardex[0]).toMatchObject({
        tipo: "entrada",
        origen: "manual",
        deltaDisponible: 10,
        actorTipo: "persona",
        usuarioId: usuarioAId,
        nota: "Stock inicial (importación CSV)",
        claveIdempotencia: `importacion-csv:stock-inicial:${skuId}`,
      });
    });

    it("bodega por nombre con otra capitalización y espacios: entra en esa bodega", async () => {
      const csv = csvDe(["STK-NORTE,Producto,  bodega   NORTE ,4"]);
      const vista = await previsualizarImportacionSkus(empresaAId, usuarioAId, csv);
      expect(vista.filas[0]).toMatchObject({ bodegaResuelta: "Bodega Norte", cargaStock: true, yaExiste: false });

      await confirmarImportacionSkus(empresaAId, usuarioAId, csv);
      const skuId = (await idDeSku(empresaAId, "STK-NORTE"))!;
      expect(await stockDe(empresaAId, skuId)).toEqual([{ bodegaId: norteAId, disponible: 4 }]);
    });

    it("subir el MISMO archivo dos veces: el stock sigue en 10 y hay una sola fila de kardex", async () => {
      const csv = csvDe(["STK-DOBLE,Producto,,10"]);
      await confirmarImportacionSkus(empresaAId, usuarioAId, csv);

      const vista = await previsualizarImportacionSkus(empresaAId, usuarioAId, csv);
      expect(vista.filas[0]).toMatchObject({ yaExiste: true, cargaStock: false });
      const segunda = await confirmarImportacionSkus(empresaAId, usuarioAId, csv);
      expect(segunda.stockCargado).toBe(0);
      expect(segunda.unidadesCargadas).toBe(0);

      const skuId = (await idDeSku(empresaAId, "STK-DOBLE"))!;
      expect(await stockDe(empresaAId, skuId)).toEqual([{ bodegaId: principalAId, disponible: 10 }]);
      expect(await kardexDe(empresaAId, skuId)).toHaveLength(1);
    });

    it("SKU que ya existía: se actualiza el nombre y el stock no cambia", async () => {
      await dbComoEmpresa(empresaAId, (tx) => tx.insert(skus).values({ empresaId: empresaAId, codigo: "STK-EXISTE", nombre: "Viejo" }));
      const skuId = (await idDeSku(empresaAId, "STK-EXISTE"))!;

      const resultado = await confirmarImportacionSkus(empresaAId, usuarioAId, csvDe(["STK-EXISTE,Nuevo,,8"]));
      expect(resultado.actualizados).toBe(1);
      expect(resultado.stockCargado).toBe(0);

      const [fila] = await dbComoEmpresa(empresaAId, (tx) => tx.select().from(skus).where(eq(skus.id, skuId)));
      expect(fila.nombre).toBe("Nuevo");
      expect(await stockDe(empresaAId, skuId)).toEqual([]);
      expect(await kardexDe(empresaAId, skuId)).toHaveLength(0);
    });

    it("bodega que no existe o desactivada: error en la vista previa y al confirmar no se crea ni el SKU ni el stock", async () => {
      const csv = csvDe(["STK-INVENTADA,x,Bodega Fantasma,5", "STK-CERRADA,x,bodega cerrada,5", "STK-VALIDA,x,,1"]);
      const vista = await previsualizarImportacionSkus(empresaAId, usuarioAId, csv);
      expect(vista.filas.map((f) => f.sku)).toEqual(["STK-VALIDA"]);
      expect(vista.errores.filter((e) => e.columna === "bodega").map((e) => e.numeroFila)).toEqual([2, 3]);
      expect(vista.resumen.validas).toBe(1);
      expect(vista.resumen.conError).toBe(2);

      const resultado = await confirmarImportacionSkus(empresaAId, usuarioAId, csv);
      expect(resultado.creados).toBe(1);
      expect(resultado.omitidosPorError).toBe(2);
      expect(await idDeSku(empresaAId, "STK-INVENTADA")).toBeUndefined();
      expect(await idDeSku(empresaAId, "STK-CERRADA")).toBeUndefined();
    });

    it("cantidad 0: se crea el SKU sin movimiento de stock", async () => {
      const resultado = await confirmarImportacionSkus(empresaAId, usuarioAId, csvDe(["STK-CERO,x,,0"]));
      expect(resultado.creados).toBe(1);
      expect(resultado.stockCargado).toBe(0);

      const skuId = await idDeSku(empresaAId, "STK-CERO");
      expect(skuId).toBeDefined();
      expect(await kardexDe(empresaAId, skuId!)).toHaveLength(0);
    });

    it("todo o nada: si falla el movimiento de stock, tampoco queda el SKU", async () => {
      const spy = vi.spyOn(movimientosModule, "aplicarMovimientosTx").mockRejectedValueOnce(new Error("Fallo simulado del kardex"));
      try {
        await expect(confirmarImportacionSkus(empresaAId, usuarioAId, csvDe(["STK-ATOM,x,,3"]))).rejects.toThrow("Fallo simulado del kardex");
      } finally {
        spy.mockRestore();
      }
      expect(await idDeSku(empresaAId, "STK-ATOM")).toBeUndefined();
    });

    it("sin bodega principal y cantidad > 0 sin bodega: error de fila que pide crear una bodega", async () => {
      const c = await crearEmpresaConPermiso("Empresa C sin bodegas", "inventario", "modificar");
      const vista = await previsualizarImportacionSkus(c.empresaId, c.usuarioId, csvDe(["STK-SINBOD,x,,2", "STK-SINBOD-0,x,,0"]));
      expect(vista.errores).toEqual([{ numeroFila: 2, columna: "bodega", mensaje: "Crea una bodega en /panel/bodegas primero" }]);
      expect(vista.filas.map((f) => f.sku)).toEqual(["STK-SINBOD-0"]);
    });

    it("RLS: la empresa B escribe en su CSV el nombre de una bodega de A y no carga nada en A", async () => {
      const csv = csvDe(["STK-RLS,x,Bodega Norte,7"]);
      const vista = await previsualizarImportacionSkus(empresaBId, usuarioBId, csv);
      expect(vista.filas).toHaveLength(0);
      expect(vista.errores[0]).toMatchObject({ columna: "bodega" });

      await expect(confirmarImportacionSkus(empresaBId, usuarioBId, csv)).rejects.toThrow(SinFilasValidasError);
      expect(await idDeSku(empresaBId, "STK-RLS")).toBeUndefined();
      const enNorte = await dbComoEmpresa(empresaAId, (tx) =>
        tx.select().from(kardexMovimientos).where(and(eq(kardexMovimientos.empresaId, empresaAId), eq(kardexMovimientos.bodegaId, norteAId)))
      );
      // En la bodega de A solo hay movimientos de gente de A, nunca de B.
      expect(enNorte.every((m) => m.usuarioId === usuarioAId)).toBe(true);
    });
  });
});
