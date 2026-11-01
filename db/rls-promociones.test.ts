import { randomUUID } from "crypto";
import { eq, sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { cifrarToken } from "../lib/cifrado";
import { SQL_BACKFILL_PERMISOS_PROMOCIONES } from "../lib/ml/backfill-permisos-promociones";
import { dbComoEmpresa } from "./empresa-context";
import { cuentasMl, iaConexiones, permisosRol, promocionesAcciones, promocionesCandidatos, promocionesReglas, roles } from "./schema";
import { afirmarAislamiento, crearDosEmpresas, type ContextoDosEmpresas } from "./test-utils/aislamiento";

async function crearCuentaMl(empresaId: string, nickname: string) {
  const [cuenta] = await dbComoEmpresa(empresaId, (tx) =>
    tx
      .insert(cuentasMl)
      .values({
        empresaId,
        cuentaIdExterna: `${Date.now()}${Math.floor(Math.random() * 100000)}`,
        nickname,
        accessTokenCifrado: cifrarToken("access"),
        refreshTokenCifrado: cifrarToken("refresh"),
        tokenExpiraTs: new Date(Date.now() + 3600_000),
      })
      .returning({ id: cuentasMl.id })
  );
  return cuenta.id;
}

// Rama feat-promociones — mismas 2 empresas de siempre, contra
// Postgres real (RLS no se simula). Sin afirmarAislamiento() para
// promociones_reglas/candidatos/acciones: app_user no tiene DELETE en
// esas 3 tablas (igual que costos_sku) — el DELETE de B daría error de
// permiso, no "0 filas", así que se prueba a mano (mismo criterio que
// db/rls-costos-sku.test.ts). ia_conexiones SÍ tiene DELETE, así que
// esa usa la plantilla genérica.
describe("promociones_reglas/candidatos/acciones + ia_conexiones (RLS, rama feat-promociones)", () => {
  it("promociones_reglas — empresa B no ve ni edita la fila de A; A sí la edita; DELETE falla para las dos", async () => {
    const contexto = await crearDosEmpresas();
    const cuentaAId = await crearCuentaMl(contexto.empresaAId, "Cuenta A");

    const [filaA] = await dbComoEmpresa(contexto.empresaAId, (tx) =>
      tx.insert(promocionesReglas).values({ empresaId: contexto.empresaAId, cuentaMlId: cuentaAId }).returning({ id: promocionesReglas.id })
    );

    const veB = await dbComoEmpresa(contexto.empresaBId, (tx) => tx.select().from(promocionesReglas).where(eq(promocionesReglas.id, filaA.id)));
    expect(veB).toHaveLength(0);

    const editadasPorB = await dbComoEmpresa(contexto.empresaBId, (tx) =>
      tx.update(promocionesReglas).set({ descuentoMaximoPct: 1 }).where(eq(promocionesReglas.id, filaA.id)).returning({ id: promocionesReglas.id })
    );
    expect(editadasPorB).toHaveLength(0);

    const editadasPorA = await dbComoEmpresa(contexto.empresaAId, (tx) =>
      tx.update(promocionesReglas).set({ descuentoMaximoPct: 15 }).where(eq(promocionesReglas.id, filaA.id)).returning({ descuentoMaximoPct: promocionesReglas.descuentoMaximoPct })
    );
    expect(editadasPorA).toEqual([{ descuentoMaximoPct: 15 }]);

    await expect(dbComoEmpresa(contexto.empresaAId, (tx) => tx.delete(promocionesReglas).where(eq(promocionesReglas.id, filaA.id)))).rejects.toThrow(/permission denied/);
  });

  it("promociones_reglas — una sola fila por cuenta (unique), y el tope de descuento está en (0,100]", async () => {
    const { empresaAId } = await crearDosEmpresas();
    const cuentaId = await crearCuentaMl(empresaAId, "Cuenta única");
    await dbComoEmpresa(empresaAId, (tx) => tx.insert(promocionesReglas).values({ empresaId: empresaAId, cuentaMlId: cuentaId }));

    await expect(
      dbComoEmpresa(empresaAId, (tx) => tx.insert(promocionesReglas).values({ empresaId: empresaAId, cuentaMlId: cuentaId }))
    ).rejects.toThrow();

    const cuentaOtraId = await crearCuentaMl(empresaAId, "Otra");
    await expect(
      dbComoEmpresa(empresaAId, (tx) => tx.insert(promocionesReglas).values({ empresaId: empresaAId, cuentaMlId: cuentaOtraId, descuentoMaximoPct: 0 }))
    ).rejects.toThrow();
    const cuentaOtra2Id = await crearCuentaMl(empresaAId, "Otra 2");
    await expect(
      dbComoEmpresa(empresaAId, (tx) => tx.insert(promocionesReglas).values({ empresaId: empresaAId, cuentaMlId: cuentaOtra2Id, descuentoMaximoPct: 101 }))
    ).rejects.toThrow();
  });

  it("promociones_candidatos — empresa B no ve ni edita; mismo (cuenta,item,tipo) upsertea, nunca duplica", async () => {
    const contexto = await crearDosEmpresas();
    const cuentaAId = await crearCuentaMl(contexto.empresaAId, "Cuenta A");

    const [filaA] = await dbComoEmpresa(contexto.empresaAId, (tx) =>
      tx
        .insert(promocionesCandidatos)
        .values({ empresaId: contexto.empresaAId, cuentaMlId: cuentaAId, itemId: "MCO1", tipoPromocion: "DEAL", estadoMl: "candidate" })
        .returning({ id: promocionesCandidatos.id })
    );

    const veB = await dbComoEmpresa(contexto.empresaBId, (tx) => tx.select().from(promocionesCandidatos).where(eq(promocionesCandidatos.id, filaA.id)));
    expect(veB).toHaveLength(0);

    await expect(
      dbComoEmpresa(contexto.empresaAId, (tx) =>
        tx.insert(promocionesCandidatos).values({ empresaId: contexto.empresaAId, cuentaMlId: cuentaAId, itemId: "MCO1", tipoPromocion: "DEAL", estadoMl: "candidate" })
      )
    ).rejects.toThrow();
  });

  it("promociones_acciones — empresa B no ve ni edita la fila de A; A sí puede actualizar su propio estado", async () => {
    const contexto = await crearDosEmpresas();
    const cuentaAId = await crearCuentaMl(contexto.empresaAId, "Cuenta A");

    const [filaA] = await dbComoEmpresa(contexto.empresaAId, (tx) =>
      tx
        .insert(promocionesAcciones)
        .values({ empresaId: contexto.empresaAId, cuentaMlId: cuentaAId, itemId: "MCO1", tipoPromocion: "DEAL", accion: "participar" })
        .returning({ id: promocionesAcciones.id })
    );

    const veB = await dbComoEmpresa(contexto.empresaBId, (tx) => tx.select().from(promocionesAcciones).where(eq(promocionesAcciones.id, filaA.id)));
    expect(veB).toHaveLength(0);

    const editadaPorA = await dbComoEmpresa(contexto.empresaAId, (tx) =>
      tx.update(promocionesAcciones).set({ estado: "aceptada" }).where(eq(promocionesAcciones.id, filaA.id)).returning({ estado: promocionesAcciones.estado })
    );
    expect(editadaPorA).toEqual([{ estado: "aceptada" }]);
  });

  it("ia_conexiones — aislamiento genérico (SELECT/UPDATE/DELETE), y una sola conexión por empresa", async () => {
    const contexto: ContextoDosEmpresas = await crearDosEmpresas();
    await afirmarAislamiento(contexto, iaConexiones, (tx, empresaId) =>
      tx
        .insert(iaConexiones)
        .values({ empresaId, proveedor: "anthropic", modelo: "claude-sonnet-5", apiKeyCifrada: cifrarToken("sk-ant-prueba") })
        .returning({ id: iaConexiones.id })
    );

    await expect(
      dbComoEmpresa(contexto.empresaBId, (tx) =>
        tx.insert(iaConexiones).values({ empresaId: contexto.empresaBId, proveedor: "openai", modelo: "gpt-5", apiKeyCifrada: cifrarToken("sk-prueba") })
      )
    ).resolves.toBeDefined();

    await expect(
      dbComoEmpresa(contexto.empresaBId, (tx) =>
        tx.insert(iaConexiones).values({ empresaId: contexto.empresaBId, proveedor: "google", modelo: "gemini", apiKeyCifrada: cifrarToken("otra-key") })
      )
    ).rejects.toThrow();
  });

  it("ia_conexiones — la api_key_cifrada nunca viaja en texto plano en la fila guardada", async () => {
    const { empresaAId } = await crearDosEmpresas();
    const claveReal = "sk-ant-super-secreta-de-prueba";
    const [fila] = await dbComoEmpresa(empresaAId, (tx) =>
      tx.insert(iaConexiones).values({ empresaId: empresaAId, proveedor: "anthropic", modelo: "claude-sonnet-5", apiKeyCifrada: cifrarToken(claveReal) }).returning()
    );
    expect(JSON.stringify(fila.apiKeyCifrada)).not.toContain(claveReal);
  });

  // Rama fix-promociones-permisos-dueno — mismo criterio real que
  // db/rls-publicidad.test.ts (issue #254): el backfill de la
  // migración 0018 le da promociones.* a roles ya creados ANTES de que
  // existiera el módulo, nunca a Contador (que no debería tenerlo), y
  // corre dos veces sin duplicar filas (NOT EXISTS, idempotente).
  it("el backfill de la migración 0018 da promociones.* a roles ya creados y no se lo da al Contador", async () => {
    const contexto = await crearDosEmpresas();
    const gerenteId = randomUUID();
    const duenoId = randomUUID();
    const operadorId = randomUUID();
    const contadorId = randomUUID();
    await dbComoEmpresa(contexto.empresaAId, async (tx) => {
      await tx.insert(roles).values([
        { id: gerenteId, nombre: "Gerente", empresaId: contexto.empresaAId },
        { id: duenoId, nombre: "Dueño", empresaId: contexto.empresaAId },
        { id: operadorId, nombre: "Operador", empresaId: contexto.empresaAId },
        { id: contadorId, nombre: "Contador", empresaId: contexto.empresaAId },
      ]);
      await tx.insert(permisosRol).values({ id: randomUUID(), rolId: contadorId, modulo: "finanzas", accion: "consultar", alcance: "todo" });
      for (const sentencia of SQL_BACKFILL_PERMISOS_PROMOCIONES) {
        await tx.execute(sql.raw(sentencia));
      }
      // Corre dos veces a propósito — el NOT EXISTS tiene que frenar
      // la segunda pasada sin duplicar ninguna fila.
      for (const sentencia of SQL_BACKFILL_PERMISOS_PROMOCIONES) {
        await tx.execute(sql.raw(sentencia));
      }
    });

    const filas = await dbComoEmpresa(contexto.empresaAId, (tx) =>
      tx
        .select({ rolId: permisosRol.rolId, accion: permisosRol.accion })
        .from(permisosRol)
        .where(eq(permisosRol.modulo, "promociones"))
    );
    const de = (rolId: string) => filas.filter((f) => f.rolId === rolId).map((f) => f.accion).sort();
    expect(de(gerenteId)).toEqual(["aprobar", "consultar", "ejecutar"]);
    expect(de(duenoId)).toEqual(["anular", "aprobar", "autorizar", "consultar", "crear", "ejecutar", "modificar"]);
    expect(de(operadorId)).toEqual(["consultar"]);
    expect(de(contadorId)).toEqual([]);
  });
});
