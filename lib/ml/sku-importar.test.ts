import { randomUUID } from "crypto";
import { eq } from "drizzle-orm";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { db } from "@/db";
import { dbComoEmpresa } from "@/db/empresa-context";
import { empresas, membresias, permisosRol, roles, skus, usuarios } from "@/db/schema";
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

  beforeAll(async () => {
    const a = await crearEmpresaConPermiso("Empresa A importar CSV", "inventario", "modificar");
    empresaAId = a.empresaId;
    usuarioAId = a.usuarioId;

    const b = await crearEmpresaConPermiso("Empresa B importar CSV", "inventario", "modificar");
    empresaBId = b.empresaId;
    usuarioBId = b.usuarioId;

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

    const resultado = await confirmarImportacionSkus(empresaAId, usuarioAId, csv);
    expect(resultado.creados).toBe(0);
    expect(resultado.actualizados).toBe(0);

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

  it("código existente sin nombre en el CSV: se deja el nombre como estaba (no se actualiza a vacío)", async () => {
    await dbComoEmpresa(empresaAId, (tx) => tx.insert(skus).values({ empresaId: empresaAId, codigo: "YA-EXISTE-2", nombre: "Nombre que se queda" }));

    const csv = csvDe(["YA-EXISTE-2,,,0"]);
    await confirmarImportacionSkus(empresaAId, usuarioAId, csv);

    const [fila] = await dbComoEmpresa(empresaAId, (tx) => tx.select().from(skus).where(eq(skus.codigo, "YA-EXISTE-2")));
    expect(fila.nombre).toBe("Nombre que se queda");
  });

  it("un fallo real a mitad de la importación no deja nada a medias (todo o nada)", async () => {
    // ATOM-OK-1 pasa la validación del parser y SÍ cabría en la base
    // sola; un código de 3000 caracteres también pasa el parser (no
    // valida longitud), pero revienta de verdad en Postgres al
    // insertarlo (excede el tamaño máximo de una fila de índice
    // btree) — un error real de la base, no simulado. Si la
    // transacción no fuera atómica, ATOM-OK-1 quedaría creado solo.
    const codigoEnorme = "X".repeat(3000);
    const csv = csvDe(["ATOM-OK-1,Primero,,1", `${codigoEnorme},Segundo,,1`]);

    await expect(confirmarImportacionSkus(empresaAId, usuarioAId, csv)).rejects.toThrow();

    const fila = await dbComoEmpresa(empresaAId, (tx) => tx.select().from(skus).where(eq(skus.codigo, "ATOM-OK-1")));
    expect(fila).toHaveLength(0); // nunca quedó creado, aunque su insert haya ido primero
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
});
