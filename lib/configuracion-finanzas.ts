import { eq } from "drizzle-orm";
import { dbComoEmpresa } from "@/db/empresa-context";
import { configuracionFinanzas } from "@/db/schema";
import { registrarAuditoria } from "@/lib/auditoria";
import { enmascararCorreo, enmascararWhatsapp } from "@/lib/finanzas/enmascarar";
import { MontoInvalidoError, validarMonto } from "@/lib/finanzas/montos";
import { requierePermiso } from "@/lib/permisos";

// Issue #125 — una fila por empresa. Sin fila, no hay configuración:
// esta lectura devuelve null y no rellena 19 % de IVA, ni 3 días, ni
// avisos apagados. El issue deja esos defaults de "sin fila" a decidir
// y dice explícitamente que no se asume 19 %. El 3 de
// plazo_vencimiento_dias es el default de la columna cuando la fila
// sí se inserta sin ese campo, no un valor que se invente al leer.
//
// Quién puede editarla (`requierePermiso` de configuracion) es la
// pantalla del issue #126. Acá no hay ruta.

export type DatosConfiguracionFinanzas = {
  flexValor: string | null;
  ivaPublicidad: string | null;
  plazoVencimientoDias: number;
  avisoDiasAntes: number | null;
  avisoCorreoActivo: boolean | null;
  avisoWhatsappActivo: boolean | null;
  avisoCorreoDestino: string | null;
  avisoWhatsappDestino: string | null;
};

export type ConfiguracionFinanzas = DatosConfiguracionFinanzas & {
  id: string;
  empresaId: string;
  actualizadaTs: Date;
  actualizadaPor: string | null;
};

function filaADatos(fila: {
  flexValor: string | null;
  ivaPublicidad: string | null;
  plazoVencimientoDias: number;
  avisoDiasAntes: number | null;
  avisoCorreoActivo: boolean | null;
  avisoWhatsappActivo: boolean | null;
  avisoCorreoDestino: string | null;
  avisoWhatsappDestino: string | null;
}): DatosConfiguracionFinanzas {
  return {
    flexValor: fila.flexValor,
    ivaPublicidad: fila.ivaPublicidad,
    plazoVencimientoDias: fila.plazoVencimientoDias,
    avisoDiasAntes: fila.avisoDiasAntes,
    avisoCorreoActivo: fila.avisoCorreoActivo,
    avisoWhatsappActivo: fila.avisoWhatsappActivo,
    avisoCorreoDestino: fila.avisoCorreoDestino,
    avisoWhatsappDestino: fila.avisoWhatsappDestino,
  };
}

// Lo que va a la bitácora. Correo y WhatsApp, enmascarados. El resto
// son cifras de la empresa, no secretos.
export function textoAuditoriaConfiguracion(datos: DatosConfiguracionFinanzas): string {
  const bandera = (valor: boolean | null) => (valor === null ? "" : valor ? "1" : "0");
  return [
    `flex=${datos.flexValor ?? ""}`,
    `iva=${datos.ivaPublicidad ?? ""}`,
    `plazo=${datos.plazoVencimientoDias}`,
    `aviso_dias=${datos.avisoDiasAntes ?? ""}`,
    `correo_activo=${bandera(datos.avisoCorreoActivo)}`,
    `whatsapp_activo=${bandera(datos.avisoWhatsappActivo)}`,
    `correo=${datos.avisoCorreoDestino ? enmascararCorreo(datos.avisoCorreoDestino) : ""}`,
    `whatsapp=${datos.avisoWhatsappDestino ? enmascararWhatsapp(datos.avisoWhatsappDestino) : ""}`,
  ].join(" ");
}

export async function leerConfiguracionFinanzas(empresaId: string): Promise<ConfiguracionFinanzas | null> {
  return dbComoEmpresa(empresaId, async (tx) => {
    const [fila] = await tx.select().from(configuracionFinanzas).where(eq(configuracionFinanzas.empresaId, empresaId));
    if (!fila) return null;
    return {
      id: fila.id,
      empresaId: fila.empresaId,
      actualizadaTs: fila.actualizadaTs,
      actualizadaPor: fila.actualizadaPor,
      ...filaADatos(fila),
    };
  });
}

export async function guardarConfiguracionFinanzas(
  empresaId: string,
  usuarioId: string,
  datos: DatosConfiguracionFinanzas
): Promise<{ id: string }> {
  return dbComoEmpresa(empresaId, async (tx) => {
    const [previa] = await tx.select().from(configuracionFinanzas).where(eq(configuracionFinanzas.empresaId, empresaId));
    let id: string;
    const valores = {
      flexValor: datos.flexValor,
      ivaPublicidad: datos.ivaPublicidad,
      plazoVencimientoDias: datos.plazoVencimientoDias,
      avisoDiasAntes: datos.avisoDiasAntes,
      avisoCorreoActivo: datos.avisoCorreoActivo,
      avisoWhatsappActivo: datos.avisoWhatsappActivo,
      avisoCorreoDestino: datos.avisoCorreoDestino,
      avisoWhatsappDestino: datos.avisoWhatsappDestino,
      actualizadaPor: usuarioId,
      actualizadaTs: new Date(),
    };
    if (!previa) {
      const [fila] = await tx
        .insert(configuracionFinanzas)
        .values({ empresaId, ...valores })
        .returning({ id: configuracionFinanzas.id });
      id = fila.id;
    } else {
      id = previa.id;
      await tx.update(configuracionFinanzas).set(valores).where(eq(configuracionFinanzas.id, id));
    }

    await registrarAuditoria(tx, {
      empresaId,
      usuarioId,
      actorTipo: "persona",
      accion: previa ? "modificar" : "crear",
      entidad: "configuracion_finanzas",
      entidadId: id,
      detalle: previa ? "Actualizó la configuración de finanzas." : "Creó la configuración de finanzas.",
      valorAnterior: previa ? textoAuditoriaConfiguracion(filaADatos(previa)) : undefined,
      valorNuevo: textoAuditoriaConfiguracion(datos),
    });
    return { id };
  });
}

// Issue #126 (slice urgente, Sharel 30-oct) — solo el valor Flex, desde
// /panel/finanzas/configuracion. Sin él, las ventas Flex no se congelan
// (alerta flex_sin_valor en congelar.ts). Guarda SOLO flex_valor: el
// resto de la fila (IVA, plazo, avisos) queda como estaba. Sin fila, se
// crea con el plazo por defecto de la columna (3) y lo demás vacío, igual
// que un insert sin esos campos. Pide finanzas.modificar acá también
// (no solo en la acción). No toca ventas ya congeladas: el valor aplica
// a las que se congelen desde ahora.
export async function guardarValorFlex(empresaId: string, usuarioId: string, flexValor: string): Promise<{ id: string }> {
  await requierePermiso(usuarioId, empresaId, "finanzas", "modificar");
  const valor = validarMonto(flexValor, "Valor Flex");
  if (valor === null) throw new MontoInvalidoError("Valor Flex");
  const previa = await leerConfiguracionFinanzas(empresaId);
  const base: DatosConfiguracionFinanzas = previa
    ? filaADatos(previa)
    : {
        flexValor: null,
        ivaPublicidad: null,
        plazoVencimientoDias: 3,
        avisoDiasAntes: null,
        avisoCorreoActivo: null,
        avisoWhatsappActivo: null,
        avisoCorreoDestino: null,
        avisoWhatsappDestino: null,
      };
  return guardarConfiguracionFinanzas(empresaId, usuarioId, { ...base, flexValor: valor });
}
