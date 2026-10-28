import { and, eq } from "drizzle-orm";
import { dbComoEmpresa } from "@/db/empresa-context";
import { cuentasMl, titulares } from "@/db/schema";
import { registrarAuditoria } from "@/lib/auditoria";
import { enmascararDocumento } from "@/lib/finanzas/enmascarar";

// Issue #125 — alta y asignación de titulares. El permiso
// (`requierePermiso` de configuracion) y la pantalla son el issue
// #126: acá no hay ruta. El documento solo entra a `auditoria` ya
// enmascarado.

export class TitularNoEncontradoError extends Error {
  constructor() {
    super("Ese titular no está en esta empresa.");
    this.name = "TitularNoEncontradoError";
  }
}

export class CuentaMlNoEncontradaError extends Error {
  constructor() {
    super("Esa cuenta de Mercado Libre no está en esta empresa.");
    this.name = "CuentaMlNoEncontradaError";
  }
}

export class DocumentoTitularRepetidoError extends Error {
  constructor() {
    super("Ya hay un titular con ese documento en esta empresa.");
    this.name = "DocumentoTitularRepetidoError";
  }
}

export class TitularInvalidoError extends Error {
  constructor(mensaje: string) {
    super(mensaje);
    this.name = "TitularInvalidoError";
  }
}

type TipoTitular = "persona" | "sociedad";

function esViolacionUnica(e: unknown): boolean {
  const error = e as { code?: string; cause?: { code?: string } };
  return error.code === "23505" || error.cause?.code === "23505";
}

export async function listarTitulares(empresaId: string) {
  return dbComoEmpresa(empresaId, (tx) => tx.select().from(titulares).where(eq(titulares.empresaId, empresaId)));
}

export async function crearTitular(entrada: {
  empresaId: string;
  usuarioId: string;
  tipo: TipoTitular;
  nombre: string;
  documento: string;
}): Promise<{ id: string }> {
  const nombre = entrada.nombre.trim();
  const documento = entrada.documento.trim();
  if (!nombre) throw new TitularInvalidoError("El nombre del titular es obligatorio.");
  if (!documento) throw new TitularInvalidoError("El documento del titular es obligatorio.");

  try {
    return await dbComoEmpresa(entrada.empresaId, async (tx) => {
      const [fila] = await tx
        .insert(titulares)
        .values({
          empresaId: entrada.empresaId,
          tipo: entrada.tipo,
          nombre,
          documento,
        })
        .returning({ id: titulares.id });

      await registrarAuditoria(tx, {
        empresaId: entrada.empresaId,
        usuarioId: entrada.usuarioId,
        actorTipo: "persona",
        accion: "crear",
        entidad: "titular",
        entidadId: fila.id,
        // El nombre sí; el documento, solo la cola. Nunca el valor crudo.
        detalle: `Creó el titular «${nombre}».`,
        valorNuevo: enmascararDocumento(documento),
      });
      return { id: fila.id };
    });
  } catch (e) {
    if (esViolacionUnica(e)) throw new DocumentoTitularRepetidoError();
    throw e;
  }
}

export async function asignarTitularACuenta(entrada: {
  empresaId: string;
  usuarioId: string;
  cuentaMlId: string;
  // null desasigna. Un titular de otra empresa no se ve por RLS y
  // falla antes de tocar la fila; la FK compuesta es el respaldo.
  titularId: string | null;
}): Promise<void> {
  await dbComoEmpresa(entrada.empresaId, async (tx) => {
    const [cuenta] = await tx
      .select({ id: cuentasMl.id, titularId: cuentasMl.titularId })
      .from(cuentasMl)
      .where(and(eq(cuentasMl.id, entrada.cuentaMlId), eq(cuentasMl.empresaId, entrada.empresaId)));
    if (!cuenta) throw new CuentaMlNoEncontradaError();

    let documentoNuevo: string | null = null;
    if (entrada.titularId) {
      const [titular] = await tx
        .select({ id: titulares.id, documento: titulares.documento })
        .from(titulares)
        .where(and(eq(titulares.id, entrada.titularId), eq(titulares.empresaId, entrada.empresaId)));
      if (!titular) throw new TitularNoEncontradoError();
      documentoNuevo = titular.documento;
    }

    let documentoAnterior: string | null = null;
    if (cuenta.titularId) {
      const [anterior] = await tx
        .select({ documento: titulares.documento })
        .from(titulares)
        .where(eq(titulares.id, cuenta.titularId));
      documentoAnterior = anterior?.documento ?? null;
    }

    const actualizadas = await tx
      .update(cuentasMl)
      .set({ titularId: entrada.titularId })
      .where(and(eq(cuentasMl.id, entrada.cuentaMlId), eq(cuentasMl.empresaId, entrada.empresaId)))
      .returning({ id: cuentasMl.id });
    if (actualizadas.length === 0) throw new CuentaMlNoEncontradaError();

    await registrarAuditoria(tx, {
      empresaId: entrada.empresaId,
      usuarioId: entrada.usuarioId,
      actorTipo: "persona",
      accion: "modificar",
      entidad: "cuenta_ml",
      entidadId: entrada.cuentaMlId,
      detalle: entrada.titularId ? "Asignó un titular a la cuenta." : "Quitó el titular de la cuenta.",
      valorAnterior: documentoAnterior ? enmascararDocumento(documentoAnterior) : undefined,
      valorNuevo: documentoNuevo ? enmascararDocumento(documentoNuevo) : undefined,
    });
  });
}
