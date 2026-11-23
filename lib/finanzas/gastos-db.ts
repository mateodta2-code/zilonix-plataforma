import { and, asc, desc, eq, gte, lte, or } from "drizzle-orm";
import { dbComoEmpresa } from "@/db/empresa-context";
import { categoriasGasto, cuentasFalabella, cuentasMl, gastos, terceros } from "@/db/schema";
import { registrarAuditoria } from "@/lib/auditoria";
import { requierePermiso } from "@/lib/permisos";
import { CategoriaGastoInvalidaError, normalizarNombreCategoria } from "./gastos-categorias";
import { esUuid, GastoInvalidoError, mesDeDia, textoAuditoriaGasto, validarPago, type EstadoGasto, type GastoValidado, type Periodo } from "./gastos";
import { monedaDeEmpresa } from "./inventario-valorizado";

// Issue #422 (fase 4 de Finanzas) — gastos externos contra Postgres.
// Siempre dbComoEmpresa (RLS) y, además, empresa_id explícito en cada
// consulta y en cada join: si un día la política se afloja por error,
// esto no mezcla empresas igual. requierePermiso también acá (consultar
// para leer, modificar para escribir), para quien llame sin pasar por
// app/. Cada escritura deja su rastro en `auditoria` en la misma
// transacción.

export class GastoNoEncontradoError extends Error {
  constructor() {
    // Mismo mensaje si no existe o es de otra empresa.
    super("Ese gasto no está en esta empresa.");
    this.name = "GastoNoEncontradoError";
  }
}

export class CategoriaGastoRepetidaError extends Error {
  constructor() {
    super("Ya hay una categoría con ese nombre en esta empresa.");
    this.name = "CategoriaGastoRepetidaError";
  }
}

function esUnicidad(e: unknown): boolean {
  const error = e as { code?: string; cause?: { code?: string } };
  return (error.code ?? error.cause?.code) === "23505";
}

// ---------- Categorías ----------

export async function listarCategoriasGasto(empresaId: string, usuarioId: string, opciones: { incluirInactivas?: boolean } = {}) {
  await requierePermiso(usuarioId, empresaId, "finanzas", "consultar");
  return dbComoEmpresa(empresaId, (tx) =>
    tx
      .select({ id: categoriasGasto.id, nombre: categoriasGasto.nombre, activa: categoriasGasto.activa })
      .from(categoriasGasto)
      .where(
        opciones.incluirInactivas
          ? eq(categoriasGasto.empresaId, empresaId)
          : and(eq(categoriasGasto.empresaId, empresaId), eq(categoriasGasto.activa, true))
      )
      .orderBy(asc(categoriasGasto.nombre))
  );
}

export async function crearCategoriaGasto(entrada: { empresaId: string; usuarioId: string; nombre: string }): Promise<{ id: string }> {
  await requierePermiso(entrada.usuarioId, entrada.empresaId, "finanzas", "modificar");
  const nombre = normalizarNombreCategoria(entrada.nombre);
  try {
    return await dbComoEmpresa(entrada.empresaId, async (tx) => {
      const [fila] = await tx
        .insert(categoriasGasto)
        .values({ empresaId: entrada.empresaId, nombre, actualizadoPor: entrada.usuarioId })
        .returning({ id: categoriasGasto.id });
      await registrarAuditoria(tx, {
        empresaId: entrada.empresaId,
        usuarioId: entrada.usuarioId,
        actorTipo: "persona",
        accion: "crear",
        entidad: "categoria_gasto",
        entidadId: fila.id,
        detalle: `Creó la categoría de gasto «${nombre}».`,
      });
      return { id: fila.id };
    });
  } catch (e) {
    if (esUnicidad(e)) throw new CategoriaGastoRepetidaError();
    throw e;
  }
}

// Renombrar y activar/desactivar van juntos: es el mismo formulario.
export async function actualizarCategoriaGasto(entrada: {
  empresaId: string;
  usuarioId: string;
  categoriaId: string;
  nombre: string;
  activa: boolean;
}): Promise<void> {
  await requierePermiso(entrada.usuarioId, entrada.empresaId, "finanzas", "modificar");
  if (!esUuid(entrada.categoriaId)) throw new CategoriaGastoInvalidaError("Esa categoría no está en esta empresa.");
  const nombre = normalizarNombreCategoria(entrada.nombre);
  try {
    await dbComoEmpresa(entrada.empresaId, async (tx) => {
      const [previa] = await tx
        .select({ nombre: categoriasGasto.nombre, activa: categoriasGasto.activa })
        .from(categoriasGasto)
        .where(and(eq(categoriasGasto.id, entrada.categoriaId), eq(categoriasGasto.empresaId, entrada.empresaId)));
      if (!previa) throw new CategoriaGastoInvalidaError("Esa categoría no está en esta empresa.");
      await tx
        .update(categoriasGasto)
        .set({ nombre, activa: entrada.activa, actualizadoTs: new Date(), actualizadoPor: entrada.usuarioId })
        .where(and(eq(categoriasGasto.id, entrada.categoriaId), eq(categoriasGasto.empresaId, entrada.empresaId)));
      await registrarAuditoria(tx, {
        empresaId: entrada.empresaId,
        usuarioId: entrada.usuarioId,
        actorTipo: "persona",
        accion: previa.activa === entrada.activa ? "modificar" : entrada.activa ? "activar" : "desactivar",
        entidad: "categoria_gasto",
        entidadId: entrada.categoriaId,
        valorAnterior: `«${previa.nombre}»${previa.activa ? "" : " (inactiva)"}`,
        valorNuevo: `«${nombre}»${entrada.activa ? "" : " (inactiva)"}`,
      });
    });
  } catch (e) {
    if (esUnicidad(e)) throw new CategoriaGastoRepetidaError();
    throw e;
  }
}

// ---------- Opciones del formulario ----------

export type TiendaGasto = { clave: string; nombre: string; marketplace: "ml" | "falabella"; moneda: string | null };

export async function leerOpcionesGasto(empresaId: string, usuarioId: string) {
  await requierePermiso(usuarioId, empresaId, "finanzas", "consultar");
  return dbComoEmpresa(empresaId, async (tx) => {
    const ml = await tx
      .select({ id: cuentasMl.id, nombre: cuentasMl.nickname, moneda: cuentasMl.moneda })
      .from(cuentasMl)
      .where(eq(cuentasMl.empresaId, empresaId))
      .orderBy(asc(cuentasMl.nickname));
    const falabella = await tx
      .select({ id: cuentasFalabella.id, nombre: cuentasFalabella.nickname })
      .from(cuentasFalabella)
      .where(eq(cuentasFalabella.empresaId, empresaId))
      .orderBy(asc(cuentasFalabella.nickname));
    const proveedores = await tx
      .select({ id: terceros.id, nombre: terceros.nombre })
      .from(terceros)
      .where(and(eq(terceros.empresaId, empresaId), eq(terceros.activo, true)))
      .orderBy(asc(terceros.nombre));
    const tiendas: TiendaGasto[] = [
      ...ml.map((c) => ({ clave: `ml:${c.id}`, nombre: c.nombre, marketplace: "ml" as const, moneda: c.moneda })),
      ...falabella.map((c) => ({ clave: `falabella:${c.id}`, nombre: c.nombre, marketplace: "falabella" as const, moneda: null })),
    ];
    return { tiendas, proveedores, monedaEmpresa: monedaDeEmpresa(ml.map((c) => c.moneda)) };
  });
}

type Tx = Parameters<Parameters<typeof dbComoEmpresa>[1]>[0];

// La moneda nunca viene del formulario: una tienda de Mercado Libre usa
// la suya (cuentas_ml.moneda, derivada del site_id); Falabella no guarda
// moneda por cuenta, así que ella y los gastos de toda la empresa usan
// la de la empresa (monedaDeEmpresa, lib/finanzas/inventario-valorizado.ts).
// De paso confirma que la tienda, la categoría y el proveedor son de esta
// empresa (las FKs compuestas también lo fuerzan, esto da el mensaje).
async function resolverReferencias(tx: Tx, empresaId: string, datos: GastoValidado, categoriaPrevia: string | null = null): Promise<{ moneda: string }> {
  const [categoria] = await tx
    .select({ activa: categoriasGasto.activa })
    .from(categoriasGasto)
    .where(and(eq(categoriasGasto.id, datos.categoriaId), eq(categoriasGasto.empresaId, empresaId)));
  if (!categoria) throw new GastoInvalidoError("Esa categoría no está en esta empresa.");
  // Una categoría desactivada no recibe gastos nuevos; uno que ya la
  // tenía se puede seguir editando sin cambiarla.
  if (!categoria.activa && datos.categoriaId !== categoriaPrevia) throw new GastoInvalidoError("Esa categoría está desactivada.");

  if (datos.terceroId) {
    const [tercero] = await tx
      .select({ id: terceros.id })
      .from(terceros)
      .where(and(eq(terceros.id, datos.terceroId), eq(terceros.empresaId, empresaId)));
    if (!tercero) throw new GastoInvalidoError("Ese proveedor no está en esta empresa.");
  }

  if (datos.tienda?.marketplace === "ml") {
    const [cuenta] = await tx
      .select({ moneda: cuentasMl.moneda })
      .from(cuentasMl)
      .where(and(eq(cuentasMl.id, datos.tienda.cuentaId), eq(cuentasMl.empresaId, empresaId)));
    if (!cuenta) throw new GastoInvalidoError("Esa tienda no está en esta empresa.");
    return { moneda: cuenta.moneda };
  }
  if (datos.tienda?.marketplace === "falabella") {
    const [cuenta] = await tx
      .select({ id: cuentasFalabella.id })
      .from(cuentasFalabella)
      .where(and(eq(cuentasFalabella.id, datos.tienda.cuentaId), eq(cuentasFalabella.empresaId, empresaId)));
    if (!cuenta) throw new GastoInvalidoError("Esa tienda no está en esta empresa.");
  }
  const monedas = await tx.select({ moneda: cuentasMl.moneda }).from(cuentasMl).where(eq(cuentasMl.empresaId, empresaId));
  return { moneda: monedaDeEmpresa(monedas.map((m) => m.moneda)) };
}

function columnasGasto(datos: GastoValidado) {
  return {
    cuentaMlId: datos.tienda?.marketplace === "ml" ? datos.tienda.cuentaId : null,
    cuentaFalabellaId: datos.tienda?.marketplace === "falabella" ? datos.tienda.cuentaId : null,
    categoriaId: datos.categoriaId,
    terceroId: datos.terceroId,
    beneficiario: datos.beneficiario,
    descripcion: datos.descripcion,
    monto: datos.monto,
    fechaGasto: datos.fechaGasto,
    fechaVencimiento: datos.fechaVencimiento,
    estado: datos.estado,
    fechaPago: datos.fechaPago,
    medioPago: datos.medioPago,
    soporte: datos.soporte,
  };
}

// ---------- Gastos ----------

export async function crearGasto(entrada: { empresaId: string; usuarioId: string; datos: GastoValidado }): Promise<{ id: string }> {
  await requierePermiso(entrada.usuarioId, entrada.empresaId, "finanzas", "modificar");
  return dbComoEmpresa(entrada.empresaId, async (tx) => {
    const { moneda } = await resolverReferencias(tx, entrada.empresaId, entrada.datos);
    const [fila] = await tx
      .insert(gastos)
      .values({ empresaId: entrada.empresaId, ...columnasGasto(entrada.datos), moneda, creadoPor: entrada.usuarioId, actualizadoPor: entrada.usuarioId })
      .returning({ id: gastos.id });
    await registrarAuditoria(tx, {
      empresaId: entrada.empresaId,
      usuarioId: entrada.usuarioId,
      actorTipo: "persona",
      accion: "crear",
      entidad: "gasto",
      entidadId: fila.id,
      detalle: "Registró un gasto externo.",
      valorNuevo: textoAuditoriaGasto(entrada.datos, moneda),
    });
    return { id: fila.id };
  });
}

export async function editarGasto(entrada: { empresaId: string; usuarioId: string; gastoId: string; datos: GastoValidado }): Promise<void> {
  await requierePermiso(entrada.usuarioId, entrada.empresaId, "finanzas", "modificar");
  if (!esUuid(entrada.gastoId)) throw new GastoNoEncontradoError();
  await dbComoEmpresa(entrada.empresaId, async (tx) => {
    const [previo] = await tx.select().from(gastos).where(and(eq(gastos.id, entrada.gastoId), eq(gastos.empresaId, entrada.empresaId)));
    if (!previo) throw new GastoNoEncontradoError();
    const { moneda } = await resolverReferencias(tx, entrada.empresaId, entrada.datos, previo.categoriaId);
    await tx
      .update(gastos)
      .set({ ...columnasGasto(entrada.datos), moneda, actualizadoTs: new Date(), actualizadoPor: entrada.usuarioId })
      .where(and(eq(gastos.id, entrada.gastoId), eq(gastos.empresaId, entrada.empresaId)));
    await registrarAuditoria(tx, {
      empresaId: entrada.empresaId,
      usuarioId: entrada.usuarioId,
      actorTipo: "persona",
      accion: "modificar",
      entidad: "gasto",
      entidadId: entrada.gastoId,
      detalle: "Editó un gasto externo.",
      valorAnterior: textoAuditoriaGasto(previo, previo.moneda),
      valorNuevo: textoAuditoriaGasto(entrada.datos, moneda),
    });
  });
}

export async function marcarGastoPagado(entrada: {
  empresaId: string;
  usuarioId: string;
  gastoId: string;
  fechaPago: string;
  medioPago: string;
}): Promise<void> {
  await requierePermiso(entrada.usuarioId, entrada.empresaId, "finanzas", "modificar");
  if (!esUuid(entrada.gastoId)) throw new GastoNoEncontradoError();
  const pago = validarPago(entrada.fechaPago, entrada.medioPago);
  await dbComoEmpresa(entrada.empresaId, async (tx) => {
    const filas = await tx
      .update(gastos)
      .set({ estado: "pagado", fechaPago: pago.fechaPago, medioPago: pago.medioPago, actualizadoTs: new Date(), actualizadoPor: entrada.usuarioId })
      .where(and(eq(gastos.id, entrada.gastoId), eq(gastos.empresaId, entrada.empresaId), eq(gastos.estado, "pendiente")))
      .returning({ descripcion: gastos.descripcion });
    if (filas.length === 0) throw new GastoNoEncontradoError();
    await registrarAuditoria(tx, {
      empresaId: entrada.empresaId,
      usuarioId: entrada.usuarioId,
      actorTipo: "persona",
      accion: "pagar",
      entidad: "gasto",
      entidadId: entrada.gastoId,
      detalle: `Marcó como pagado el gasto «${filas[0].descripcion}» el ${pago.fechaPago}.`,
    });
  });
}

export async function leerGasto(empresaId: string, usuarioId: string, gastoId: string) {
  await requierePermiso(usuarioId, empresaId, "finanzas", "consultar");
  if (!esUuid(gastoId)) return null;
  const [fila] = await dbComoEmpresa(empresaId, (tx) =>
    tx.select().from(gastos).where(and(eq(gastos.id, gastoId), eq(gastos.empresaId, empresaId)))
  );
  return fila ?? null;
}

export type FilaGasto = {
  id: string;
  cuentaMlId: string | null;
  cuentaFalabellaId: string | null;
  categoriaId: string;
  categoria: string;
  proveedor: string | null;
  beneficiario: string | null;
  descripcion: string;
  monto: string;
  moneda: string;
  fechaGasto: string;
  fechaVencimiento: string | null;
  estado: EstadoGasto;
  fechaPago: string | null;
  medioPago: string | null;
  soporte: string | null;
};

// Lo que necesitan la tabla (el rango elegido) y las tarjetas (el mes
// en curso y todo lo pendiente). La pantalla filtra el resto en memoria
// (lib/finanzas/gastos.ts), con tope para no traer años de historia.
export async function leerGastosParaPantalla(empresaId: string, usuarioId: string, rango: Periodo, hoy: string): Promise<FilaGasto[]> {
  await requierePermiso(usuarioId, empresaId, "finanzas", "consultar");
  const mes = mesDeDia(hoy);
  return dbComoEmpresa(empresaId, (tx) =>
    tx
      .select({
        id: gastos.id,
        cuentaMlId: gastos.cuentaMlId,
        cuentaFalabellaId: gastos.cuentaFalabellaId,
        categoriaId: gastos.categoriaId,
        categoria: categoriasGasto.nombre,
        proveedor: terceros.nombre,
        beneficiario: gastos.beneficiario,
        descripcion: gastos.descripcion,
        monto: gastos.monto,
        moneda: gastos.moneda,
        fechaGasto: gastos.fechaGasto,
        fechaVencimiento: gastos.fechaVencimiento,
        estado: gastos.estado,
        fechaPago: gastos.fechaPago,
        medioPago: gastos.medioPago,
        soporte: gastos.soporte,
      })
      .from(gastos)
      .innerJoin(categoriasGasto, and(eq(categoriasGasto.id, gastos.categoriaId), eq(categoriasGasto.empresaId, empresaId)))
      .leftJoin(terceros, and(eq(terceros.id, gastos.terceroId), eq(terceros.empresaId, empresaId)))
      .where(
        and(
          eq(gastos.empresaId, empresaId),
          or(
            and(gte(gastos.fechaGasto, rango.desde), lte(gastos.fechaGasto, rango.hasta)),
            and(gte(gastos.fechaGasto, mes.desde), lte(gastos.fechaGasto, mes.hasta)),
            eq(gastos.estado, "pendiente")
          )
        )
      )
      .orderBy(desc(gastos.fechaGasto), desc(gastos.creadoTs))
      .limit(2000)
  );
}
