import { randomUUID } from "crypto";
import { eq, sql } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { dbComoEmpresa } from "./empresa-context";
import { configuracionFinanzas, terceros } from "./schema";
import { crearDosEmpresas, type ContextoDosEmpresas } from "./test-utils/aislamiento";
import { MontoInvalidoError } from "../lib/finanzas/montos";
import {
  TerceroInvalidoError,
  TerceroRepetidoError,
  crearTercero,
  desactivarTercero,
  listarTerceros,
  plazoEfectivoDias,
} from "../lib/terceros";

// Issue #127 (Z-FIN-05) — terceros contra Postgres real. No usa
// afirmarAislamiento(): esa plantilla espera que el DELETE de B afecte
// 0 filas, y acá app_user no tiene DELETE en absoluto (un tercero se
// desactiva, no se borra).

function nombreUnico(base: string): string {
  return `${base} ${randomUUID().slice(0, 8)}`;
}

describe("terceros (RLS, issue #127)", () => {
  let contexto: ContextoDosEmpresas;
  let terceroAId: string;

  beforeAll(async () => {
    contexto = await crearDosEmpresas();
    ({ id: terceroAId } = await crearTercero({
      empresaId: contexto.empresaAId,
      usuarioId: contexto.usuarioAId,
      nombre: "Infinity",
      tipo: "proveedor_producto",
      empaque: "3000",
      condicionPago: "inmediato",
    }));
  });

  it("empresa B no ve ni edita el tercero de A; A sí lo edita", async () => {
    const veB = await dbComoEmpresa(contexto.empresaBId, (tx) => tx.select().from(terceros).where(eq(terceros.id, terceroAId)));
    expect(veB).toHaveLength(0);

    const editadasPorB = await dbComoEmpresa(contexto.empresaBId, (tx) =>
      tx.update(terceros).set({ nombre: "Robado" }).where(eq(terceros.id, terceroAId)).returning({ id: terceros.id })
    );
    expect(editadasPorB).toHaveLength(0);

    const editadasPorA = await dbComoEmpresa(contexto.empresaAId, (tx) =>
      tx.update(terceros).set({ empaque: "3500.00" }).where(eq(terceros.id, terceroAId)).returning({ empaque: terceros.empaque })
    );
    expect(editadasPorA).toEqual([{ empaque: "3500.00" }]);
  });

  it("con app_user, DELETE falla, aun para la empresa dueña", async () => {
    await expect(
      dbComoEmpresa(contexto.empresaAId, (tx) => tx.delete(terceros).where(eq(terceros.id, terceroAId)))
    ).rejects.toThrow(/permission denied/);
    await expect(
      dbComoEmpresa(contexto.empresaBId, (tx) => tx.delete(terceros).where(eq(terceros.id, terceroAId)))
    ).rejects.toThrow(/permission denied/);
  });

  it("cuenta_cobro sin periodicidad se rechaza; inmediato y anticipado_full_ml no la exigen", async () => {
    await expect(
      dbComoEmpresa(contexto.empresaAId, (tx) =>
        tx.insert(terceros).values({ empresaId: contexto.empresaAId, nombre: nombreUnico("Sin periodo"), tipo: "otro", condicionPago: "cuenta_cobro" })
      )
    ).rejects.toThrow();
    await expect(
      crearTercero({
        empresaId: contexto.empresaAId,
        usuarioId: contexto.usuarioAId,
        nombre: nombreUnico("Sin periodo helper"),
        tipo: "otro",
        condicionPago: "cuenta_cobro",
      })
    ).rejects.toBeInstanceOf(TerceroInvalidoError);

    for (const condicionPago of ["inmediato", "anticipado_full_ml"] as const) {
      await expect(
        dbComoEmpresa(contexto.empresaAId, (tx) =>
          tx.insert(terceros).values({ empresaId: contexto.empresaAId, nombre: nombreUnico(condicionPago), tipo: "otro", condicionPago })
        )
      ).resolves.toBeDefined();
    }
  });

  it("agencia y flex nacen como cuenta de cobro semanal; los demás tipos piden la condición", async () => {
    const empresas = await crearDosEmpresas();
    for (const tipo of ["agencia", "flex"] as const) {
      const { id } = await crearTercero({ empresaId: empresas.empresaAId, usuarioId: empresas.usuarioAId, nombre: `Mensajería ${tipo}`, tipo });
      const [fila] = await dbComoEmpresa(empresas.empresaAId, (tx) => tx.select().from(terceros).where(eq(terceros.id, id)));
      expect(fila.condicionPago).toBe("cuenta_cobro");
      expect(fila.periodicidad).toBe("semanal");
    }
    await expect(
      crearTercero({ empresaId: empresas.empresaAId, usuarioId: empresas.usuarioAId, nombre: "Proveedor sin condición", tipo: "proveedor_producto" })
    ).rejects.toBeInstanceOf(TerceroInvalidoError);
  });

  it("dos terceros habituales del mismo concepto en una empresa fallan; en empresas distintas no", async () => {
    const empresas = await crearDosEmpresas();
    const conceptos = [
      { marca: "predeterminadoFlex", tipo: "flex" },
      { marca: "predeterminadoEnvioAgencia", tipo: "agencia" },
      { marca: "predeterminadoEmpaque", tipo: "empaque" },
    ] as const;

    for (const { marca, tipo } of conceptos) {
      await crearTercero({ empresaId: empresas.empresaAId, usuarioId: empresas.usuarioAId, nombre: `${tipo} 1`, tipo, condicionPago: "inmediato", [marca]: true });
      await expect(
        crearTercero({ empresaId: empresas.empresaAId, usuarioId: empresas.usuarioAId, nombre: `${tipo} 2`, tipo, condicionPago: "inmediato", [marca]: true })
      ).rejects.toBeInstanceOf(TerceroRepetidoError);
      await expect(
        crearTercero({ empresaId: empresas.empresaBId, usuarioId: empresas.usuarioBId, nombre: `${tipo} 1`, tipo, condicionPago: "inmediato", [marca]: true })
      ).resolves.toHaveProperty("id");
    }
  });

  it("un mismo tercero puede ser habitual de agencia y de empaque a la vez", async () => {
    const { empresaAId, usuarioAId } = await crearDosEmpresas();
    const { id } = await crearTercero({
      empresaId: empresaAId,
      usuarioId: usuarioAId,
      nombre: "Agencia y packing",
      tipo: "agencia",
      predeterminadoEnvioAgencia: true,
      predeterminadoEmpaque: true,
    });
    const [fila] = await dbComoEmpresa(empresaAId, (tx) => tx.select().from(terceros).where(eq(terceros.id, id)));
    expect(fila.predeterminadoEnvioAgencia).toBe(true);
    expect(fila.predeterminadoEmpaque).toBe(true);
  });

  it("desactivar un tercero lo saca de la lista y le quita la marca de habitual", async () => {
    const { empresaAId, usuarioAId } = await crearDosEmpresas();
    const { id } = await crearTercero({ empresaId: empresaAId, usuarioId: usuarioAId, nombre: "Flex viejo", tipo: "flex", predeterminadoFlex: true });
    await desactivarTercero({ empresaId: empresaAId, usuarioId: usuarioAId, terceroId: id });

    expect((await listarTerceros(empresaAId)).map((t) => t.id)).not.toContain(id);
    const [fila] = await dbComoEmpresa(empresaAId, (tx) => tx.select().from(terceros).where(eq(terceros.id, id)));
    expect(fila.activo).toBe(false);
    expect(fila.predeterminadoFlex).toBe(false);

    // El concepto queda libre para el mensajero nuevo.
    await expect(
      crearTercero({ empresaId: empresaAId, usuarioId: usuarioAId, nombre: "Flex nuevo", tipo: "flex", predeterminadoFlex: true })
    ).resolves.toHaveProperty("id");
  });

  it("plazo_dias negativo se rechaza; vacío usa el de la configuración, y 3 si no hay configuración", async () => {
    const { empresaAId, usuarioAId } = await crearDosEmpresas();
    await expect(
      dbComoEmpresa(empresaAId, (tx) =>
        tx.insert(terceros).values({ empresaId: empresaAId, nombre: "Plazo negativo", tipo: "otro", condicionPago: "inmediato", plazoDias: -1 })
      )
    ).rejects.toThrow();

    const { id: sinPlazo } = await crearTercero({ empresaId: empresaAId, usuarioId: usuarioAId, nombre: "Sin plazo", tipo: "agencia" });
    const { id: conPlazo } = await crearTercero({ empresaId: empresaAId, usuarioId: usuarioAId, nombre: "Con plazo", tipo: "agencia", plazoDias: 10 });

    expect(await plazoEfectivoDias(empresaAId, sinPlazo)).toBe(3);
    await dbComoEmpresa(empresaAId, (tx) => tx.insert(configuracionFinanzas).values({ empresaId: empresaAId, plazoVencimientoDias: 7 }));
    expect(await plazoEfectivoDias(empresaAId, sinPlazo)).toBe(7);
    expect(await plazoEfectivoDias(empresaAId, conPlazo)).toBe(10);
  });

  it("empaque negativo o con más de 2 decimales se rechaza; 0 es un valor real", async () => {
    const { empresaAId, usuarioAId } = await crearDosEmpresas();
    await expect(
      dbComoEmpresa(empresaAId, (tx) => tx.execute(sql`insert into terceros (empresa_id, nombre, tipo, condicion_pago, empaque) values (${empresaAId}, 'Negativo', 'otro', 'inmediato', -1)`))
    ).rejects.toThrow();
    await expect(
      crearTercero({ empresaId: empresaAId, usuarioId: usuarioAId, nombre: "Tres decimales", tipo: "empaque", condicionPago: "inmediato", empaque: "1.005" })
    ).rejects.toBeInstanceOf(MontoInvalidoError);

    const { id } = await crearTercero({ empresaId: empresaAId, usuarioId: usuarioAId, nombre: "Vitalcom", tipo: "proveedor_producto", condicionPago: "inmediato", empaque: 0 });
    const [fila] = await dbComoEmpresa(empresaAId, (tx) => tx.select().from(terceros).where(eq(terceros.id, id)));
    expect(fila.empaque).toBe("0.00");
  });

  it("el mismo nombre en dos empresas se permite; en la misma, no", async () => {
    const empresas = await crearDosEmpresas();
    await crearTercero({ empresaId: empresas.empresaAId, usuarioId: empresas.usuarioAId, nombre: "Unmerco", tipo: "proveedor_producto", condicionPago: "inmediato" });
    await expect(
      crearTercero({ empresaId: empresas.empresaBId, usuarioId: empresas.usuarioBId, nombre: "Unmerco", tipo: "proveedor_producto", condicionPago: "inmediato" })
    ).resolves.toHaveProperty("id");
    await expect(
      crearTercero({ empresaId: empresas.empresaAId, usuarioId: empresas.usuarioAId, nombre: "Unmerco", tipo: "otro", condicionPago: "inmediato" })
    ).rejects.toBeInstanceOf(TerceroRepetidoError);
  });
});
