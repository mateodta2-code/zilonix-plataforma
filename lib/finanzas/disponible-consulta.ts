import { and, asc, eq, isNull } from "drizzle-orm";
import { dbComoEmpresa } from "@/db/empresa-context";
import { cuentasDisponible, cuentasMl, cuentasMp, saldosDisponible, usuarios } from "@/db/schema";
import { registrarAuditoria } from "@/lib/auditoria";
import { esUuid } from "@/lib/inventario/calculos";
import { SITE_ID_DEFECTO, SITIOS_ML } from "@/lib/ml/sitios";
import {
  CandadoRenovacionMpError,
  CuentaMpDesconectadaError,
  obtenerAccessTokenMpVigente,
  RenovacionTokenMpFallidaError,
} from "@/lib/mp/cuentas";
import {
  asegurarConfigReporteLiberaciones,
  descargarReporteLiberaciones,
  ErrorLiberacionesMp,
  extraerSaldoDeCsvLiberaciones,
  listarReportesLiberaciones,
  rangoReporteLiberaciones,
  solicitarReporteLiberaciones,
  type CodigoErrorLiberacionesMp,
  type ReporteLiberacionesListado,
} from "@/lib/mp/liberaciones-reporte";
import { requierePermiso } from "@/lib/permisos";
import {
  DisponibleInvalidoError,
  validarCuenta,
  validarSaldo,
  type CuentaDisponible,
  type CuentaMpDisponible,
  type SaldoDisponible,
} from "./disponible";
import { diaBogota } from "./utilidad-venta";

// Issue #422 (fase 6, Disponible) — lectura y escritura de cuentas y
// saldos. Siempre dbComoEmpresa (RLS) y, además, empresa_id explícito en
// cada filtro: si la política se afloja por error, igual no se mezclan
// empresas. requierePermiso también acá, para quien llame sin pasar por
// app/: ver = finanzas.consultar; crear y registrar = finanzas.modificar.

export class CuentaDisponibleRepetidaError extends Error {}

// El cuentaId llega del formulario: un texto que no es UUID hacía que
// Postgres respondiera 22P02 (invalid_text_representation) y la página
// diera 500. Se corta antes de consultar, con el mismo mensaje que una
// cuenta que no existe.
function validarCuentaId(cuentaId: string): void {
  if (!esUuid(cuentaId)) throw new DisponibleInvalidoError("Elige una cuenta.");
}

export async function leerDisponible(
  empresaId: string,
  usuarioId: string
): Promise<{ cuentas: CuentaDisponible[]; saldos: SaldoDisponible[]; monedaSugerida: string }> {
  await requierePermiso(usuarioId, empresaId, "finanzas", "consultar");
  return dbComoEmpresa(empresaId, async (tx) => {
    const cuentas = await tx
      .select({
        id: cuentasDisponible.id,
        nombre: cuentasDisponible.nombre,
        tipo: cuentasDisponible.tipo,
        entidad: cuentasDisponible.entidad,
        ultimos4: cuentasDisponible.ultimos4,
        moneda: cuentasDisponible.moneda,
        activa: cuentasDisponible.activa,
      })
      .from(cuentasDisponible)
      .where(eq(cuentasDisponible.empresaId, empresaId))
      .orderBy(asc(cuentasDisponible.tipo), asc(cuentasDisponible.nombre));
    const saldos = await tx
      .select({
        id: saldosDisponible.id,
        cuentaId: saldosDisponible.cuentaId,
        saldo: saldosDisponible.saldo,
        fechaCorte: saldosDisponible.fechaCorte,
        nota: saldosDisponible.nota,
        registradoPor: usuarios.nombre,
        creadoTs: saldosDisponible.creadoTs,
      })
      .from(saldosDisponible)
      .leftJoin(usuarios, eq(usuarios.id, saldosDisponible.registradoPor))
      .where(eq(saldosDisponible.empresaId, empresaId));
    // Moneda sugerida en el formulario: la de la cuenta de Mercado Libre
    // más antigua de la empresa; sin cuentas, la del sitio por defecto.
    const [ml] = await tx
      .select({ moneda: cuentasMl.moneda })
      .from(cuentasMl)
      .where(eq(cuentasMl.empresaId, empresaId))
      .orderBy(asc(cuentasMl.creadoTs))
      .limit(1);
    return { cuentas, saldos, monedaSugerida: ml?.moneda ?? SITIOS_ML[SITE_ID_DEFECTO].moneda };
  });
}

// ---------- Mercado Pago (Reporte de Liberaciones) ----------

// Lee el último saldo guardado de cada cuenta de Mercado Pago activa. Sin
// llamadas a Mercado Pago: la página carga rápido y una cuenta caída no
// la tumba. Para refrescar está sincronizarSaldoMp («Actualizar saldo»).
export async function leerCuentasMpDisponible(empresaId: string, usuarioId: string): Promise<CuentaMpDisponible[]> {
  await requierePermiso(usuarioId, empresaId, "finanzas", "consultar");
  return dbComoEmpresa(empresaId, (tx) =>
    tx
      .select({
        id: cuentasMp.id,
        cuentaIdExterna: cuentasMp.cuentaIdExterna,
        nickname: cuentasMp.nickname,
        ultimoSaldoDisponible: cuentasMp.ultimoSaldoDisponible,
        ultimaMoneda: cuentasMp.ultimaMoneda,
        ultimoCorteFecha: cuentasMp.ultimoCorteFecha,
        ultimoSaldoTs: cuentasMp.ultimoSaldoTs,
        reportePendienteFile: cuentasMp.reportePendienteFile,
        reportePendienteTs: cuentasMp.reportePendienteTs,
        ultimoErrorSaldo: cuentasMp.ultimoErrorSaldo,
      })
      .from(cuentasMp)
      .where(and(eq(cuentasMp.empresaId, empresaId), isNull(cuentasMp.desconectadaTs)))
      .orderBy(asc(cuentasMp.creadoTs))
  );
}

// Un reporte pedido hace menos de esto no se vuelve a pedir: Mercado Pago
// todavía lo está generando.
const ESPERA_REPORTE_PENDIENTE_MS = 5 * 60_000;

export type CodigoErrorSaldoMp = CodigoErrorLiberacionesMp | "mp_renovando" | "mp_reconectar" | "mp_error";

export type ResultadoSincronizacionMp =
  | { estado: "actualizado"; saldo: string; moneda: string; fechaCorte: string }
  | { estado: "en_preparacion" }
  | { estado: "error"; codigo: CodigoErrorSaldoMp };

function codigoDeError(error: unknown): CodigoErrorSaldoMp {
  if (error instanceof ErrorLiberacionesMp) return error.codigo;
  if (error instanceof CandadoRenovacionMpError) return "mp_renovando";
  if (error instanceof RenovacionTokenMpFallidaError || error instanceof CuentaMpDesconectadaError) return "mp_reconectar";
  return "mp_error";
}

// El reporte a descargar: el que se pidió (por file_name o id) si ya está
// listo; si no, el listo más reciente generado después del último saldo.
function elegirReporte(
  lista: ReporteLiberacionesListado[],
  cuenta: { ultimoSaldoTs: Date | null; reportePendienteFile: string | null; reportePendienteTs: Date | null }
): ReporteLiberacionesListado | null {
  const listos = lista.filter((r) => r.listo);
  const pedido = cuenta.reportePendienteFile;
  if (pedido) {
    const coincide = listos.find((r) => r.fileName === pedido || r.id === pedido);
    if (coincide) return coincide;
  }
  const desde = cuenta.ultimoSaldoTs?.getTime() ?? null;
  const nuevos = listos
    .filter((r) => r.creadoTs !== null && (desde === null || r.creadoTs.getTime() > desde))
    .sort((a, b) => (b.creadoTs as Date).getTime() - (a.creadoTs as Date).getTime());
  return nuevos[0] ?? null;
}

// «Actualizar saldo»: si ya hay un reporte listo nuevo, se descarga y se
// guarda el saldo; si no, se pide uno (Mercado Pago tarda unos minutos) y
// se marca como pendiente. Token y llamadas a Mercado Pago van FUERA de
// cualquier transacción; las escrituras son transacciones cortas. Un
// error queda como código corto en ultimo_error_saldo, nunca el body.
export async function sincronizarSaldoMp(entrada: { empresaId: string; usuarioId: string; cuentaMpId: string }): Promise<ResultadoSincronizacionMp> {
  const { empresaId, usuarioId, cuentaMpId } = entrada;
  await requierePermiso(usuarioId, empresaId, "finanzas", "modificar");
  if (!esUuid(cuentaMpId)) throw new DisponibleInvalidoError("No se encontró la cuenta de Mercado Pago.");
  const deEstaCuenta = and(eq(cuentasMp.id, cuentaMpId), eq(cuentasMp.empresaId, empresaId), isNull(cuentasMp.desconectadaTs));

  const [cuenta] = await dbComoEmpresa(empresaId, (tx) =>
    tx
      .select({
        id: cuentasMp.id,
        nombre: cuentasMp.nickname,
        cuentaIdExterna: cuentasMp.cuentaIdExterna,
        ultimoSaldoTs: cuentasMp.ultimoSaldoTs,
        reportePendienteFile: cuentasMp.reportePendienteFile,
        reportePendienteTs: cuentasMp.reportePendienteTs,
      })
      .from(cuentasMp)
      .where(deEstaCuenta)
  );
  if (!cuenta) throw new DisponibleInvalidoError("No se encontró la cuenta de Mercado Pago.");
  const nombre = cuenta.nombre ?? cuenta.cuentaIdExterna;

  const auditar = (detalle: string, valorNuevo?: string) =>
    dbComoEmpresa(empresaId, async (tx) => {
      await registrarAuditoria(tx, {
        empresaId,
        usuarioId,
        actorTipo: "persona",
        accion: "sincronizar_saldo",
        entidad: "cuenta_mp",
        entidadId: cuenta.id,
        ...(valorNuevo === undefined ? {} : { valorNuevo }),
        detalle,
      });
    });

  try {
    const token = await obtenerAccessTokenMpVigente(empresaId, cuenta.id);
    const reporte = elegirReporte(await listarReportesLiberaciones(token), cuenta);

    if (reporte) {
      const leido = extraerSaldoDeCsvLiberaciones(await descargarReporteLiberaciones(token, reporte.fileName));
      if (!leido) throw new ErrorLiberacionesMp("mp_sin_datos");
      const fechaCorte = leido.fecha ?? diaBogota(new Date());
      await dbComoEmpresa(empresaId, async (tx) => {
        await tx
          .update(cuentasMp)
          .set({
            ultimoSaldoDisponible: leido.saldo,
            ultimaMoneda: leido.moneda,
            ultimoCorteFecha: fechaCorte,
            ultimoSaldoTs: new Date(),
            reportePendienteFile: null,
            reportePendienteTs: null,
            ultimoErrorSaldo: null,
          })
          .where(deEstaCuenta);
        await registrarAuditoria(tx, {
          empresaId,
          usuarioId,
          actorTipo: "persona",
          accion: "sincronizar_saldo",
          entidad: "cuenta_mp",
          entidadId: cuenta.id,
          valorNuevo: leido.saldo,
          detalle: `Saldo de Mercado Pago ${nombre} (${leido.moneda}), corte ${fechaCorte}.`,
        });
      });
      return { estado: "actualizado", saldo: leido.saldo, moneda: leido.moneda, fechaCorte };
    }

    const pedidoReciente = cuenta.reportePendienteTs !== null && Date.now() - cuenta.reportePendienteTs.getTime() < ESPERA_REPORTE_PENDIENTE_MS;
    if (pedidoReciente) return { estado: "en_preparacion" };

    await asegurarConfigReporteLiberaciones(token);
    const { beginDateIso, endDateIso } = rangoReporteLiberaciones(new Date());
    const solicitud = await solicitarReporteLiberaciones(token, beginDateIso, endDateIso);
    const pendiente = "fileName" in solicitud ? solicitud.fileName : solicitud.taskId;
    await dbComoEmpresa(empresaId, (tx) =>
      tx.update(cuentasMp).set({ reportePendienteFile: pendiente, reportePendienteTs: new Date(), ultimoErrorSaldo: null }).where(deEstaCuenta)
    );
    await auditar(`Pidió el reporte de liberaciones de Mercado Pago ${nombre}.`);
    return { estado: "en_preparacion" };
  } catch (error) {
    const codigo = codigoDeError(error);
    // Solo el código y el nombre del error: nunca el token ni el CSV.
    console.warn(`[lib/finanzas/disponible-consulta] no se pudo sincronizar el saldo de Mercado Pago (cuenta ${cuenta.id}):`, codigo, error instanceof Error ? error.name : "desconocido");
    await dbComoEmpresa(empresaId, (tx) => tx.update(cuentasMp).set({ ultimoErrorSaldo: codigo }).where(deEstaCuenta));
    await auditar(`No se pudo actualizar el saldo de Mercado Pago ${nombre} (${codigo}).`);
    return { estado: "error", codigo };
  }
}

// 23505 = unique_violation (mismo criterio que lib/terceros.ts).
function esNombreRepetido(e: unknown): boolean {
  const error = e as { code?: string; constraint_name?: string; cause?: { code?: string; constraint_name?: string } };
  const codigo = error.code ?? error.cause?.code;
  const restriccion = error.constraint_name ?? error.cause?.constraint_name ?? "";
  return codigo === "23505" && restriccion === "cuentas_disponible_empresa_nombre_unico";
}

export async function crearCuentaDisponible(entrada: {
  empresaId: string;
  usuarioId: string;
  nombre: string;
  tipo: string;
  entidad: string;
  ultimos4: string;
  moneda: string;
}): Promise<{ id: string }> {
  await requierePermiso(entrada.usuarioId, entrada.empresaId, "finanzas", "modificar");
  const datos = validarCuenta(entrada);
  try {
    return await dbComoEmpresa(entrada.empresaId, async (tx) => {
      const [fila] = await tx
        .insert(cuentasDisponible)
        .values({ empresaId: entrada.empresaId, ...datos, creadoPor: entrada.usuarioId })
        .returning({ id: cuentasDisponible.id });
      await registrarAuditoria(tx, {
        empresaId: entrada.empresaId,
        usuarioId: entrada.usuarioId,
        actorTipo: "persona",
        accion: "crear",
        entidad: "cuenta_disponible",
        entidadId: fila.id,
        // Nunca los últimos 4 dígitos en la auditoría: basta con el nombre.
        detalle: `${datos.nombre} (${datos.tipo}, ${datos.moneda})`,
      });
      return fila;
    });
  } catch (error) {
    if (esNombreRepetido(error)) throw new CuentaDisponibleRepetidaError("Ya tienes una cuenta con ese nombre.");
    throw error;
  }
}

export async function registrarSaldoDisponible(entrada: {
  empresaId: string;
  usuarioId: string;
  cuentaId: string;
  saldo: string;
  fechaCorte: string;
  nota: string;
  hoy: string;
}): Promise<{ id: string }> {
  await requierePermiso(entrada.usuarioId, entrada.empresaId, "finanzas", "modificar");
  const datos = validarSaldo(entrada, entrada.hoy);
  validarCuentaId(entrada.cuentaId);
  return dbComoEmpresa(entrada.empresaId, async (tx) => {
    // RLS ya esconde la cuenta de otra empresa; esto da un mensaje claro
    // en vez del error de la FK compuesta.
    const [cuenta] = await tx
      .select({ id: cuentasDisponible.id, activa: cuentasDisponible.activa })
      .from(cuentasDisponible)
      .where(and(eq(cuentasDisponible.id, entrada.cuentaId), eq(cuentasDisponible.empresaId, entrada.empresaId)));
    if (!cuenta) throw new DisponibleInvalidoError("Elige una cuenta.");
    if (!cuenta.activa) throw new DisponibleInvalidoError("La cuenta está desactivada: reactívala para registrar un saldo.");

    const [fila] = await tx
      .insert(saldosDisponible)
      .values({ empresaId: entrada.empresaId, cuentaId: cuenta.id, ...datos, registradoPor: entrada.usuarioId })
      .returning({ id: saldosDisponible.id });
    await registrarAuditoria(tx, {
      empresaId: entrada.empresaId,
      usuarioId: entrada.usuarioId,
      actorTipo: "persona",
      accion: "registrar_saldo",
      entidad: "cuenta_disponible",
      entidadId: cuenta.id,
      valorNuevo: datos.saldo,
      detalle: `Corte ${datos.fechaCorte}`,
    });
    return fila;
  });
}

export async function cambiarActivaCuentaDisponible(entrada: {
  empresaId: string;
  usuarioId: string;
  cuentaId: string;
  activa: boolean;
}): Promise<void> {
  await requierePermiso(entrada.usuarioId, entrada.empresaId, "finanzas", "modificar");
  validarCuentaId(entrada.cuentaId);
  await dbComoEmpresa(entrada.empresaId, async (tx) => {
    const filas = await tx
      .update(cuentasDisponible)
      .set({ activa: entrada.activa })
      .where(and(eq(cuentasDisponible.id, entrada.cuentaId), eq(cuentasDisponible.empresaId, entrada.empresaId)))
      .returning({ id: cuentasDisponible.id });
    if (filas.length === 0) throw new DisponibleInvalidoError("No se encontró la cuenta.");
    await registrarAuditoria(tx, {
      empresaId: entrada.empresaId,
      usuarioId: entrada.usuarioId,
      actorTipo: "persona",
      accion: entrada.activa ? "reactivar" : "desactivar",
      entidad: "cuenta_disponible",
      entidadId: entrada.cuentaId,
    });
  });
}
