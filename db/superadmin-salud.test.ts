import { randomUUID } from "crypto";
import { sql } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { cifrarToken } from "../lib/cifrado";
import { listarSaludConexiones } from "../lib/superadmin";
import { dbComoEmpresa } from "./empresa-context";
import { dbSuperadmin } from "./superadmin-context";
import { avisosMl, cuentasMl, empresas, publicidadSincronizaciones } from "./schema";

// Salud de conexiones (25-nov) — contra Postgres real: la función
// SECURITY DEFINER cuenta cada señal y superadmin_user sigue sin poder
// leer las filas de cuentas ni de avisos (solo los conteos).
describe("superadmin: salud de conexiones", () => {
  const empresaId = randomUUID();
  const HORA = 3600_000;

  beforeAll(async () => {
    await dbComoEmpresa(empresaId, async (tx) => {
      await tx.insert(empresas).values({ id: empresaId, nombre: "Empresa Salud (prueba)", nit: `TEST-SAL-${empresaId.slice(0, 8)}` });
      const cuenta = (o: { desconectada?: boolean; vencidoHace?: number }) => ({
        empresaId,
        cuentaIdExterna: `ml-salud-${randomUUID()}`,
        nickname: "CUENTA_SALUD",
        accessTokenCifrado: cifrarToken("a"),
        refreshTokenCifrado: cifrarToken("r"),
        tokenExpiraTs: new Date(Date.now() - (o.vencidoHace ?? -HORA)),
        desconectadaTs: o.desconectada ? new Date() : null,
      });
      // 1 sana, 1 con token vencido hace 2 días, 1 desconectada.
      const [sana] = await tx.insert(cuentasMl).values(cuenta({})).returning({ id: cuentasMl.id });
      await tx.insert(cuentasMl).values(cuenta({ vencidoHace: 48 * HORA }));
      await tx.insert(cuentasMl).values(cuenta({ desconectada: true }));
      // Publicidad: la última sincronización de la sana terminó en error.
      await tx.insert(publicidadSincronizaciones).values({ empresaId, cuentaMlId: sana.id, origen: "programada", estado: "ok", iniciadaTs: new Date(Date.now() - 5 * HORA) });
      await tx.insert(publicidadSincronizaciones).values({ empresaId, cuentaMlId: sana.id, origen: "programada", estado: "error", iniciadaTs: new Date(Date.now() - HORA) });
      // Avisos: 2 sin procesar hace 3 h (atrasados), 1 reciente, 1 viejo ya procesado.
      const aviso = (recibidoHace: number, procesado: boolean) => ({
        empresaId,
        cuentaIdExterna: "x",
        topic: "items",
        resource: `/items/${randomUUID()}`,
        enviadoTs: new Date(),
        recibidoTs: new Date(Date.now() - recibidoHace),
        procesadoTs: procesado ? new Date() : null,
      });
      await tx.insert(avisosMl).values([aviso(3 * HORA, false), aviso(3 * HORA, false), aviso(60_000, false), aviso(3 * HORA, true)]);
    });
  });

  it("cuenta cada señal por empresa", async () => {
    const fila = (await listarSaludConexiones()).find((f) => f.empresaId === empresaId);
    expect(fila).toMatchObject({
      nombre: "Empresa Salud (prueba)",
      estado: "activa",
      mlConectadas: 2,
      mlDesconectadas: 1,
      mlSinRenovar: 1,
      avisosAtrasados: 2,
      publicidadConError: 1,
      falabellaDesconectadas: 0,
    });
  });

  it("superadmin_user ve los conteos pero no las filas de cuentas ni de avisos", async () => {
    await expect(dbSuperadmin.execute(sql`select count(*) from cuentas_ml`)).rejects.toThrow();
    await expect(dbSuperadmin.execute(sql`select count(*) from avisos_ml`)).rejects.toThrow();
  });
});
