import { and, asc, eq } from "drizzle-orm";
import { dbComoEmpresa } from "@/db/empresa-context";
import { cuentasDisponible, cuentasMl, saldosDisponible, usuarios } from "@/db/schema";
import { registrarAuditoria } from "@/lib/auditoria";
import { esUuid } from "@/lib/inventario/calculos";
import { SITE_ID_DEFECTO, SITIOS_ML } from "@/lib/ml/sitios";
import { requierePermiso } from "@/lib/permisos";
import {
  DisponibleInvalidoError,
  validarCuenta,
  validarSaldo,
  type CuentaDisponible,
  type SaldoDisponible,
} from "./disponible";

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
