import { randomUUID } from "crypto";
import { and, eq } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { db } from "./index";
import { dbComoEmpresa } from "./empresa-context";
import { categoriasGasto, gastos, usuarios } from "./schema";
import { crearEmpresaConDueno } from "../lib/empresas";
import { CATEGORIAS_GASTO_BASE } from "../lib/finanzas/gastos-categorias";
import { validarGasto, type EntradaGasto } from "../lib/finanzas/gastos";
import {
  actualizarCategoriaGasto,
  CategoriaGastoRepetidaError,
  crearCategoriaGasto,
  crearGasto,
  GastoNoEncontradoError,
  leerGastosParaPantalla,
  listarCategoriasGasto,
  marcarGastoPagado,
} from "../lib/finanzas/gastos-db";
import { crearTercero } from "../lib/terceros";
import { SITIOS_ML, SITE_ID_DEFECTO } from "../lib/ml/sitios";
import { SinPermisoError } from "../lib/permisos";

// Issue #422 (fase 4 de Finanzas) — gastos externos y sus categorías
// contra Postgres real con app_user: una empresa nunca ve, edita ni usa
// los gastos o categorías de otra. Cada empresa se crea con
// crearEmpresaConDueno, así de paso se prueba que nace con las
// categorías base.

async function nuevoUsuario(etiqueta: string): Promise<string> {
  const [u] = await db
    .insert(usuarios)
    .values({ email: `prueba-gastos-${etiqueta}-${randomUUID()}@zilonix.test`, nombre: `Usuario ${etiqueta} (gastos)` })
    .returning({ id: usuarios.id });
  return u.id;
}

function datos(categoriaId: string, cambios: Partial<EntradaGasto> = {}) {
  return validarGasto({
    tienda: "",
    categoriaId,
    terceroId: "",
    beneficiario: "Arrendador",
    descripcion: "Arriendo bodega",
    monto: "1500000",
    fechaGasto: "2026-11-05",
    fechaVencimiento: "2026-11-10",
    pagado: false,
    fechaPago: "",
    medioPago: "",
    soporte: "",
    ...cambios,
  });
}

describe("gastos externos (RLS, issue #422)", () => {
  let usuarioA: string;
  let usuarioB: string;
  let empresaA: string;
  let empresaB: string;
  let categoriaA: string;
  let categoriaB: string;
  let gastoA: string;

  beforeAll(async () => {
    usuarioA = await nuevoUsuario("a");
    usuarioB = await nuevoUsuario("b");
    empresaA = await crearEmpresaConDueno(usuarioA, "Empresa A (gastos)", `TEST-GA-${randomUUID().slice(0, 8)}`);
    empresaB = await crearEmpresaConDueno(usuarioB, "Empresa B (gastos)", `TEST-GB-${randomUUID().slice(0, 8)}`);
    categoriaA = (await listarCategoriasGasto(empresaA, usuarioA)).find((c) => c.nombre === "Arriendo")!.id;
    categoriaB = (await listarCategoriasGasto(empresaB, usuarioB)).find((c) => c.nombre === "Arriendo")!.id;
    ({ id: gastoA } = await crearGasto({ empresaId: empresaA, usuarioId: usuarioA, datos: datos(categoriaA) }));
  });

  it("cada empresa nueva nace con las categorías base, y solo ve las suyas", async () => {
    const deA = await listarCategoriasGasto(empresaA, usuarioA);
    expect(deA.map((c) => c.nombre).sort()).toEqual([...CATEGORIAS_GASTO_BASE].sort());
    const veB = await dbComoEmpresa(empresaB, (tx) => tx.select().from(categoriasGasto).where(eq(categoriasGasto.empresaId, empresaA)));
    expect(veB).toHaveLength(0);
  });

  it("empresa B no ve, no edita y no borra el gasto de A", async () => {
    const veB = await dbComoEmpresa(empresaB, (tx) => tx.select().from(gastos).where(eq(gastos.id, gastoA)));
    expect(veB).toHaveLength(0);
    const editadas = await dbComoEmpresa(empresaB, (tx) =>
      tx.update(gastos).set({ descripcion: "Robado" }).where(eq(gastos.id, gastoA)).returning({ id: gastos.id })
    );
    expect(editadas).toHaveLength(0);
    // Sin DELETE para app_user, ni siquiera para la empresa dueña.
    await expect(dbComoEmpresa(empresaA, (tx) => tx.delete(gastos).where(eq(gastos.id, gastoA)))).rejects.toThrow(/permission denied/);
    await expect(dbComoEmpresa(empresaB, (tx) => tx.delete(gastos).where(eq(gastos.id, gastoA)))).rejects.toThrow(/permission denied/);

    const [deA] = await dbComoEmpresa(empresaA, (tx) => tx.select().from(gastos).where(eq(gastos.id, gastoA)));
    expect(deA).toMatchObject({ descripcion: "Arriendo bodega", monto: "1500000.00", estado: "pendiente" });
  });

  it("la moneda sale de la empresa (sin cuentas ML = la del sitio por defecto), nunca del formulario", async () => {
    const [fila] = await dbComoEmpresa(empresaA, (tx) => tx.select({ moneda: gastos.moneda }).from(gastos).where(eq(gastos.id, gastoA)));
    expect(fila.moneda).toBe(SITIOS_ML[SITE_ID_DEFECTO].moneda);
  });

  it("B no puede insertar un gasto con el empresa_id de A ni usar una categoría o proveedor de A", async () => {
    await expect(
      dbComoEmpresa(empresaB, (tx) =>
        tx.insert(gastos).values({ empresaId: empresaA, categoriaId: categoriaA, beneficiario: "X", descripcion: "X", monto: "1", moneda: "COP", fechaGasto: "2026-11-01" })
      )
    ).rejects.toThrow();
    // FK compuesta: la categoría de A no existe para la empresa B.
    await expect(
      dbComoEmpresa(empresaB, (tx) =>
        tx.insert(gastos).values({ empresaId: empresaB, categoriaId: categoriaA, beneficiario: "X", descripcion: "X", monto: "1", moneda: "COP", fechaGasto: "2026-11-01" })
      )
    ).rejects.toThrow();
    await expect(crearGasto({ empresaId: empresaB, usuarioId: usuarioB, datos: datos(categoriaA) })).rejects.toThrow(/categoría no está/);

    const { id: terceroA } = await crearTercero({ empresaId: empresaA, usuarioId: usuarioA, nombre: "Contadora", tipo: "otro", empaque: null, condicionPago: "inmediato" });
    await expect(
      crearGasto({ empresaId: empresaB, usuarioId: usuarioB, datos: datos(categoriaB, { terceroId: terceroA, beneficiario: "" }) })
    ).rejects.toThrow(/proveedor no está/);
    await expect(
      dbComoEmpresa(empresaB, (tx) =>
        tx.insert(gastos).values({ empresaId: empresaB, categoriaId: categoriaB, terceroId: terceroA, descripcion: "X", monto: "1", moneda: "COP", fechaGasto: "2026-11-01" })
      )
    ).rejects.toThrow();
  });

  it("requierePermiso adentro: el usuario de B no lee ni escribe en la empresa A", async () => {
    await expect(listarCategoriasGasto(empresaA, usuarioB)).rejects.toBeInstanceOf(SinPermisoError);
    await expect(leerGastosParaPantalla(empresaA, usuarioB, { desde: "2026-11-01", hasta: "2026-11-30" }, "2026-11-22")).rejects.toBeInstanceOf(SinPermisoError);
    await expect(crearGasto({ empresaId: empresaA, usuarioId: usuarioB, datos: datos(categoriaA) })).rejects.toBeInstanceOf(SinPermisoError);
    await expect(
      marcarGastoPagado({ empresaId: empresaA, usuarioId: usuarioB, gastoId: gastoA, fechaPago: "2026-11-20", medioPago: "" })
    ).rejects.toBeInstanceOf(SinPermisoError);
  });

  it("marcar como pagado: B no lo encuentra; A sí, una sola vez", async () => {
    await expect(
      marcarGastoPagado({ empresaId: empresaB, usuarioId: usuarioB, gastoId: gastoA, fechaPago: "2026-11-20", medioPago: "" })
    ).rejects.toBeInstanceOf(GastoNoEncontradoError);

    await marcarGastoPagado({ empresaId: empresaA, usuarioId: usuarioA, gastoId: gastoA, fechaPago: "2026-11-20", medioPago: "Transferencia" });
    const [fila] = await dbComoEmpresa(empresaA, (tx) => tx.select().from(gastos).where(eq(gastos.id, gastoA)));
    expect(fila).toMatchObject({ estado: "pagado", fechaPago: "2026-11-20", medioPago: "Transferencia" });
    await expect(
      marcarGastoPagado({ empresaId: empresaA, usuarioId: usuarioA, gastoId: gastoA, fechaPago: "2026-11-21", medioPago: "" })
    ).rejects.toBeInstanceOf(GastoNoEncontradoError);

    const filas = await leerGastosParaPantalla(empresaA, usuarioA, { desde: "2026-11-01", hasta: "2026-11-30" }, "2026-11-22");
    expect(filas.map((f) => f.id)).toEqual([gastoA]);
    expect(await leerGastosParaPantalla(empresaB, usuarioB, { desde: "2026-11-01", hasta: "2026-11-30" }, "2026-11-22")).toEqual([]);
  });

  it("CHECK: pagado sin fecha de pago (o pendiente con fecha) se rechaza en la base", async () => {
    await expect(
      dbComoEmpresa(empresaA, (tx) => tx.update(gastos).set({ fechaPago: null }).where(and(eq(gastos.id, gastoA), eq(gastos.empresaId, empresaA))))
    ).rejects.toThrow();
  });

  it("categorías: B no renombra las de A; A crea, renombra y desactiva las suyas", async () => {
    await expect(
      actualizarCategoriaGasto({ empresaId: empresaB, usuarioId: usuarioB, categoriaId: categoriaA, nombre: "Robada", activa: true })
    ).rejects.toThrow(/no está en esta empresa/);

    const { id: nueva } = await crearCategoriaGasto({ empresaId: empresaA, usuarioId: usuarioA, nombre: "  Bodega   externa " });
    await expect(crearCategoriaGasto({ empresaId: empresaA, usuarioId: usuarioA, nombre: "Bodega externa" })).rejects.toBeInstanceOf(CategoriaGastoRepetidaError);
    // El mismo nombre en otra empresa no choca.
    await expect(crearCategoriaGasto({ empresaId: empresaB, usuarioId: usuarioB, nombre: "Bodega externa" })).resolves.toBeDefined();

    await actualizarCategoriaGasto({ empresaId: empresaA, usuarioId: usuarioA, categoriaId: nueva, nombre: "Bodegaje", activa: false });
    const todas = await listarCategoriasGasto(empresaA, usuarioA, { incluirInactivas: true });
    expect(todas.find((c) => c.id === nueva)).toEqual({ id: nueva, nombre: "Bodegaje", activa: false });
    expect((await listarCategoriasGasto(empresaA, usuarioA)).some((c) => c.id === nueva)).toBe(false);
    // Una categoría desactivada no recibe gastos nuevos.
    await expect(crearGasto({ empresaId: empresaA, usuarioId: usuarioA, datos: datos(nueva) })).rejects.toThrow(/desactivada/);
  });
});
