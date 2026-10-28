import { and, asc, eq } from "drizzle-orm";
import { dbComoEmpresa } from "@/db/empresa-context";
import { terceros } from "@/db/schema";
import { registrarAuditoria } from "@/lib/auditoria";
import { leerConfiguracionFinanzas } from "@/lib/configuracion-finanzas";
import { validarMonto } from "@/lib/finanzas/montos";

// Issue #127 (Z-FIN-05) — proveedores y transportadores. Quién puede
// crearlos o editarlos (requierePermiso) lo decide la pantalla de #128:
// acá no hay ruta. Un tercero nunca se borra, se desactiva.

export type TipoTercero = "proveedor_producto" | "empaque" | "agencia" | "flex" | "otro";
export type CondicionPago = "inmediato" | "cuenta_cobro" | "anticipado_full_ml";
export type Periodicidad = "semanal" | "quincenal" | "mensual";

// Si configuracion_finanzas no tiene fila (o no existe), el plazo es 3
// días: lo fija el issue #127.
const PLAZO_DIAS_POR_DEFECTO = 3;

export type DatosTercero = {
  nombre: string;
  tipo: TipoTercero;
  empaque: string | null;
  condicionPago: CondicionPago;
  periodicidad: Periodicidad | null;
  plazoDias: number | null;
  predeterminadoEnvioAgencia: boolean;
  predeterminadoEmpaque: boolean;
  predeterminadoFlex: boolean;
};

export class TerceroInvalidoError extends Error {
  constructor(mensaje: string) {
    super(mensaje);
    this.name = "TerceroInvalidoError";
  }
}

export class TerceroNoEncontradoError extends Error {
  constructor() {
    // Mismo mensaje si no existe o es de otra empresa.
    super("Ese tercero no está en esta empresa.");
    this.name = "TerceroNoEncontradoError";
  }
}

export class TerceroRepetidoError extends Error {
  constructor(mensaje: string) {
    super(mensaje);
    this.name = "TerceroRepetidoError";
  }
}

// 23505 = unique_violation. Por el nombre de la restricción se sabe si
// chocó el nombre o una marca de tercero habitual.
function errorDeUnicidad(e: unknown): TerceroRepetidoError | null {
  const error = e as { code?: string; constraint_name?: string; cause?: { code?: string; constraint_name?: string } };
  const codigo = error.code ?? error.cause?.code;
  if (codigo !== "23505") return null;
  const restriccion = error.constraint_name ?? error.cause?.constraint_name ?? "";
  if (restriccion.startsWith("terceros_habitual_")) {
    return new TerceroRepetidoError("Ya hay otro tercero habitual para ese concepto en esta empresa.");
  }
  return new TerceroRepetidoError("Ya hay un tercero con ese nombre en esta empresa.");
}

function validarDatos(datos: DatosTercero): DatosTercero {
  const nombre = datos.nombre.trim();
  if (!nombre) throw new TerceroInvalidoError("El nombre del tercero es obligatorio.");
  if (datos.condicionPago === "cuenta_cobro" && !datos.periodicidad) {
    throw new TerceroInvalidoError("Una cuenta de cobro necesita periodicidad: semanal, quincenal o mensual.");
  }
  if (datos.plazoDias !== null && (!Number.isInteger(datos.plazoDias) || datos.plazoDias < 0)) {
    throw new TerceroInvalidoError("El plazo tiene que ser un número entero de días mayor o igual a 0.");
  }
  return { ...datos, nombre, empaque: validarMonto(datos.empaque, "Empaque del tercero") };
}

// Lo que va a la bitácora. Son datos del proveedor, no secretos.
export function textoAuditoriaTercero(datos: DatosTercero & { activo?: boolean }): string {
  const marcas = [
    datos.predeterminadoEnvioAgencia ? "envio_agencia" : null,
    datos.predeterminadoEmpaque ? "empaque" : null,
    datos.predeterminadoFlex ? "flex" : null,
  ].filter(Boolean);
  return [
    `nombre=${datos.nombre}`,
    `tipo=${datos.tipo}`,
    `empaque=${datos.empaque ?? ""}`,
    `pago=${datos.condicionPago}`,
    `periodicidad=${datos.periodicidad ?? ""}`,
    `plazo=${datos.plazoDias ?? ""}`,
    `habitual=${marcas.join(",")}`,
    ...(datos.activo === undefined ? [] : [`activo=${datos.activo ? "1" : "0"}`]),
  ].join(" ");
}

export async function crearTercero(entrada: {
  empresaId: string;
  usuarioId: string;
  nombre: string;
  tipo: TipoTercero;
  empaque?: string | number | null;
  condicionPago?: CondicionPago;
  periodicidad?: Periodicidad | null;
  plazoDias?: number | null;
  predeterminadoEnvioAgencia?: boolean;
  predeterminadoEmpaque?: boolean;
  predeterminadoFlex?: boolean;
}): Promise<{ id: string }> {
  // Por defecto, agencia y flex se crean como cuenta de cobro semanal.
  // Para los demás tipos el issue no fija una condición: se pide.
  const esTransporte = entrada.tipo === "agencia" || entrada.tipo === "flex";
  const condicionPago = entrada.condicionPago ?? (esTransporte ? "cuenta_cobro" : undefined);
  if (!condicionPago) throw new TerceroInvalidoError("Elige la condición de pago del tercero.");
  const periodicidad =
    entrada.periodicidad !== undefined ? entrada.periodicidad : condicionPago === "cuenta_cobro" && esTransporte ? "semanal" : null;

  const datos = validarDatos({
    nombre: entrada.nombre,
    tipo: entrada.tipo,
    empaque: entrada.empaque === undefined || entrada.empaque === null ? null : String(entrada.empaque),
    condicionPago,
    periodicidad,
    plazoDias: entrada.plazoDias ?? null,
    predeterminadoEnvioAgencia: entrada.predeterminadoEnvioAgencia ?? false,
    predeterminadoEmpaque: entrada.predeterminadoEmpaque ?? false,
    predeterminadoFlex: entrada.predeterminadoFlex ?? false,
  });

  try {
    return await dbComoEmpresa(entrada.empresaId, async (tx) => {
      const [fila] = await tx
        .insert(terceros)
        .values({ empresaId: entrada.empresaId, ...datos, actualizadoPor: entrada.usuarioId })
        .returning({ id: terceros.id });

      await registrarAuditoria(tx, {
        empresaId: entrada.empresaId,
        usuarioId: entrada.usuarioId,
        actorTipo: "persona",
        accion: "crear",
        entidad: "tercero",
        entidadId: fila.id,
        detalle: `Creó el tercero «${datos.nombre}».`,
        valorNuevo: textoAuditoriaTercero(datos),
      });
      return { id: fila.id };
    });
  } catch (e) {
    throw errorDeUnicidad(e) ?? e;
  }
}

export async function actualizarTercero(entrada: {
  empresaId: string;
  usuarioId: string;
  terceroId: string;
  cambios: Partial<Omit<DatosTercero, "empaque">> & { empaque?: string | number | null; activo?: boolean };
}): Promise<void> {
  try {
    await dbComoEmpresa(entrada.empresaId, async (tx) => {
      const [previa] = await tx
        .select()
        .from(terceros)
        .where(and(eq(terceros.id, entrada.terceroId), eq(terceros.empresaId, entrada.empresaId)));
      if (!previa) throw new TerceroNoEncontradoError();

      const { activo, ...cambios } = entrada.cambios;
      const datos = validarDatos({
        nombre: cambios.nombre ?? previa.nombre,
        tipo: cambios.tipo ?? previa.tipo,
        empaque: cambios.empaque !== undefined ? (cambios.empaque === null ? null : String(cambios.empaque)) : previa.empaque,
        condicionPago: cambios.condicionPago ?? previa.condicionPago,
        periodicidad: cambios.periodicidad !== undefined ? cambios.periodicidad : previa.periodicidad,
        plazoDias: cambios.plazoDias !== undefined ? cambios.plazoDias : previa.plazoDias,
        predeterminadoEnvioAgencia: cambios.predeterminadoEnvioAgencia ?? previa.predeterminadoEnvioAgencia,
        predeterminadoEmpaque: cambios.predeterminadoEmpaque ?? previa.predeterminadoEmpaque,
        predeterminadoFlex: cambios.predeterminadoFlex ?? previa.predeterminadoFlex,
      });
      const nuevoActivo = activo ?? previa.activo;
      // Un tercero inactivo no puede seguir de habitual: dejaría al
      // concepto apuntando a alguien que ya no trabaja con la empresa.
      if (!nuevoActivo) {
        datos.predeterminadoEnvioAgencia = false;
        datos.predeterminadoEmpaque = false;
        datos.predeterminadoFlex = false;
      }

      await tx
        .update(terceros)
        .set({ ...datos, activo: nuevoActivo, actualizadoTs: new Date(), actualizadoPor: entrada.usuarioId })
        .where(eq(terceros.id, entrada.terceroId));

      await registrarAuditoria(tx, {
        empresaId: entrada.empresaId,
        usuarioId: entrada.usuarioId,
        actorTipo: "persona",
        accion: nuevoActivo === previa.activo ? "modificar" : nuevoActivo ? "activar" : "desactivar",
        entidad: "tercero",
        entidadId: entrada.terceroId,
        detalle: `Cambió el tercero «${datos.nombre}».`,
        valorAnterior: textoAuditoriaTercero({ ...previa, activo: previa.activo }),
        valorNuevo: textoAuditoriaTercero({ ...datos, activo: nuevoActivo }),
      });
    });
  } catch (e) {
    throw errorDeUnicidad(e) ?? e;
  }
}

export async function desactivarTercero(entrada: { empresaId: string; usuarioId: string; terceroId: string }): Promise<void> {
  await actualizarTercero({ ...entrada, cambios: { activo: false } });
}

export async function listarTerceros(empresaId: string, opciones: { incluirInactivos?: boolean } = {}) {
  return dbComoEmpresa(empresaId, (tx) =>
    tx
      .select()
      .from(terceros)
      .where(opciones.incluirInactivos ? eq(terceros.empresaId, empresaId) : and(eq(terceros.empresaId, empresaId), eq(terceros.activo, true)))
      .orderBy(asc(terceros.nombre))
  );
}

// Plazo para pagarle a este tercero: el suyo; si está vacío, el de
// configuracion_finanzas; si la empresa tampoco tiene fila, 3 días.
export async function plazoEfectivoDias(empresaId: string, terceroId: string): Promise<number> {
  const [tercero] = await dbComoEmpresa(empresaId, (tx) =>
    tx
      .select({ plazoDias: terceros.plazoDias })
      .from(terceros)
      .where(and(eq(terceros.id, terceroId), eq(terceros.empresaId, empresaId)))
  );
  if (!tercero) throw new TerceroNoEncontradoError();
  if (tercero.plazoDias !== null) return tercero.plazoDias;
  const configuracion = await leerConfiguracionFinanzas(empresaId);
  return configuracion?.plazoVencimientoDias ?? PLAZO_DIAS_POR_DEFECTO;
}
