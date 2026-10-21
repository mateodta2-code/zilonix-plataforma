import { randomUUID } from "crypto";
import { eq } from "drizzle-orm";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { db } from "@/db";
import { dbComoEmpresa } from "@/db/empresa-context";
import { cuentasMl, empresas, publicaciones, skus, usuarios } from "@/db/schema";
import { cifrarToken } from "@/lib/cifrado";
import {
  crearSku,
  definirKit,
  KitSeContieneASiMismoError,
  listarPublicacionesSinSku,
  listarSkus,
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
