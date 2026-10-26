import { randomUUID } from "crypto";
import { and, eq } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { dbComoEmpresa } from "./empresa-context";
import {
  cuentasMl,
  publicidadAnunciantes,
  publicidadAnuncios,
  publicidadCampanas,
  publicidadCostosItem,
  publicidadMetricasDiarias,
  publicidadSincronizaciones,
} from "./schema";
import { afirmarAislamiento, crearDosEmpresas, type ContextoDosEmpresas } from "./test-utils/aislamiento";
import { cifrarToken } from "../lib/cifrado";
import { guardarMetricas } from "../lib/publicidad/guardar";
import { metricasDesdeApi } from "../lib/publicidad/metricas";

// Issue #254 — las seis tablas de Product Ads. Empresa B nunca ve,
// edita ni borra una fila de empresa A. El cron
// (publicidad_trabajador_user) puede listar la cuenta sin leer el token.
describe("aislamiento por empresa — publicidad (issue #254)", () => {
  let contexto: ContextoDosEmpresas;
  let cuentaAId: string;

  beforeAll(async () => {
    contexto = await crearDosEmpresas();
    const [cuenta] = await dbComoEmpresa(contexto.empresaAId, (tx) =>
      tx
        .insert(cuentasMl)
        .values({
          empresaId: contexto.empresaAId,
          cuentaIdExterna: `ml-publicidad-${randomUUID()}`,
          nickname: "PUB_A",
          accessTokenCifrado: cifrarToken("access-publicidad"),
          refreshTokenCifrado: cifrarToken("refresh-publicidad"),
          tokenExpiraTs: new Date(Date.now() + 3_600_000),
        })
        .returning({ id: cuentasMl.id })
    );
    cuentaAId = cuenta.id;
  });

  it("empresa B nunca ve, edita ni borra el anunciante de empresa A", async () => {
    await afirmarAislamiento(contexto, publicidadAnunciantes, (tx, empresaId) =>
      tx
        .insert(publicidadAnunciantes)
        .values({ empresaId, cuentaMlId: cuentaAId, estadoAcceso: "ok", advertiserId: randomUUID() })
        .returning({ id: publicidadAnunciantes.id })
    );
  });

  it("empresa B nunca ve, edita ni borra una campaña de empresa A", async () => {
    await afirmarAislamiento(contexto, publicidadCampanas, (tx, empresaId) =>
      tx
        .insert(publicidadCampanas)
        .values({ empresaId, cuentaMlId: cuentaAId, campanaIdMl: randomUUID().replace(/-/g, "").slice(0, 12) })
        .returning({ id: publicidadCampanas.id })
    );
  });

  it("empresa B nunca ve, edita ni borra un anuncio de empresa A", async () => {
    await afirmarAislamiento(contexto, publicidadAnuncios, (tx, empresaId) =>
      tx
        .insert(publicidadAnuncios)
        .values({
          empresaId,
          cuentaMlId: cuentaAId,
          adGroupId: randomUUID().replace(/-/g, "").slice(0, 8),
          itemId: `MCO${randomUUID().replace(/-/g, "").slice(0, 8)}`,
        })
        .returning({ id: publicidadAnuncios.id })
    );
  });

  it("empresa B nunca ve, edita ni borra una métrica de empresa A", async () => {
    await afirmarAislamiento(contexto, publicidadMetricasDiarias, (tx, empresaId) =>
      tx
        .insert(publicidadMetricasDiarias)
        .values({
          empresaId,
          cuentaMlId: cuentaAId,
          nivel: "cuenta",
          entidadIdMl: randomUUID().replace(/-/g, "").slice(0, 8),
          fecha: "2026-10-01",
        })
        .returning({ id: publicidadMetricasDiarias.id })
    );
  });

  it("empresa B nunca ve, edita ni borra un costo de ítem de empresa A", async () => {
    await afirmarAislamiento(contexto, publicidadCostosItem, (tx, empresaId) =>
      tx
        .insert(publicidadCostosItem)
        .values({
          empresaId,
          cuentaMlId: cuentaAId,
          itemId: `MCO${randomUUID().replace(/-/g, "").slice(0, 8)}`,
          fecha: "2026-10-01",
        })
        .returning({ id: publicidadCostosItem.id })
    );
  });

  it("empresa B nunca ve, edita ni borra una sincronización de empresa A", async () => {
    await afirmarAislamiento(contexto, publicidadSincronizaciones, (tx, empresaId) =>
      tx
        .insert(publicidadSincronizaciones)
        .values({ empresaId, cuentaMlId: cuentaAId, origen: "programada", estado: "ok" })
        .returning({ id: publicidadSincronizaciones.id })
    );
  });

  it("la misma campaña en la misma cuenta no se inserta dos veces", async () => {
    const campanaIdMl = "9001";
    await dbComoEmpresa(contexto.empresaAId, (tx) =>
      tx.insert(publicidadCampanas).values({ empresaId: contexto.empresaAId, cuentaMlId: cuentaAId, campanaIdMl })
    );
    await expect(
      dbComoEmpresa(contexto.empresaAId, (tx) =>
        tx.insert(publicidadCampanas).values({ empresaId: contexto.empresaAId, cuentaMlId: cuentaAId, campanaIdMl })
      )
    ).rejects.toThrow();
  });

  it("guardar la misma métrica dos veces actualiza la fila, no la duplica", async () => {
    const entidadIdMl = "42";
    const fecha = "2026-10-02";
    const base = {
      cuentaMlId: cuentaAId,
      nivel: "campana" as const,
      entidadIdMl,
      fecha,
    };
    await guardarMetricas(contexto.empresaAId, [{ ...base, metricas: metricasDesdeApi({ clicks: 3, cost: 10 }) }]);
    await guardarMetricas(contexto.empresaAId, [{ ...base, metricas: metricasDesdeApi({ clicks: 9, cost: 12.5 }) }]);

    const filas = await dbComoEmpresa(contexto.empresaAId, (tx) =>
      tx
        .select({ clicks: publicidadMetricasDiarias.clicks, costo: publicidadMetricasDiarias.costo })
        .from(publicidadMetricasDiarias)
        .where(
          and(
            eq(publicidadMetricasDiarias.cuentaMlId, cuentaAId),
            eq(publicidadMetricasDiarias.nivel, "campana"),
            eq(publicidadMetricasDiarias.entidadIdMl, entidadIdMl),
            eq(publicidadMetricasDiarias.fecha, fecha)
          )
        )
    );
    expect(filas).toHaveLength(1);
    expect(filas[0].clicks).toBe(9);
    expect(filas[0].costo).toBe("12.50");
  });

  it.skipIf(!process.env.DATABASE_URL_PUBLICIDAD)(
    "publicidad_trabajador_user lista la cuenta y la bitácora, y no puede leer el token ni las campañas",
    async () => {
      const { dbTrabajadorPublicidad } = await import("./trabajador-publicidad-context");

      const vistas = await dbTrabajadorPublicidad
        .select({ id: cuentasMl.id, empresaId: cuentasMl.empresaId })
        .from(cuentasMl)
        .where(eq(cuentasMl.id, cuentaAId));
      expect(vistas).toEqual([{ id: cuentaAId, empresaId: contexto.empresaAId }]);

      await expect(
        dbTrabajadorPublicidad.select({ token: cuentasMl.accessTokenCifrado }).from(cuentasMl).limit(1)
      ).rejects.toThrow(/permission denied/i);

      await expect(dbTrabajadorPublicidad.select({ id: publicidadCampanas.id }).from(publicidadCampanas).limit(1)).rejects.toThrow(
        /permission denied/i
      );

      const [sync] = await dbComoEmpresa(contexto.empresaAId, (tx) =>
        tx
          .insert(publicidadSincronizaciones)
          .values({ empresaId: contexto.empresaAId, cuentaMlId: cuentaAId, origen: "manual", estado: "parcial" })
          .returning({ id: publicidadSincronizaciones.id })
      );
      const leidas = await dbTrabajadorPublicidad
        .select({ id: publicidadSincronizaciones.id })
        .from(publicidadSincronizaciones)
        .where(eq(publicidadSincronizaciones.id, sync.id));
      expect(leidas).toEqual([{ id: sync.id }]);
    }
  );
});
