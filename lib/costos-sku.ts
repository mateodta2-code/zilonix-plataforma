import { and, eq } from "drizzle-orm";
import { dbComoEmpresa } from "@/db/empresa-context";
import { costosSku, terceros } from "@/db/schema";
import { registrarAuditoria } from "@/lib/auditoria";
import { esCero, validarMonto } from "@/lib/finanzas/montos";
import { TerceroNoEncontradoError } from "@/lib/terceros";

// Issue #127 (Z-FIN-05) — tabla maestra por SKU. La pantalla y la
// importación son de #128: acá no hay ruta. Cada cambio queda en
// `auditoria` con el valor anterior y el nuevo.
//
// Reglas de ceros (Sharel, 22-oct-2026), aplicadas al guardar:
// - Precio mínimo 0 = "no aplica" → se guarda vacío.
// - Empaque y envío agencia 0 = $0 real → se guarda 0.00.
// - Costo vacío = sin costo; costo 0 = costo real de $0, sin alerta.

export type FuenteCosto = "manual" | "archivo";

type Monto = string | number | null;

export type DatosCostoSku = {
  nombreProducto?: string | null;
  costo?: Monto;
  empaque?: Monto;
  envioAgencia?: Monto;
  precioMinimoUnidad?: Monto;
  precioMinimoComboX2?: Monto;
  precioMinimoComboX3?: Monto;
  precioVenta?: Monto;
  terceroId?: string | null;
};

export class SkuCodigoInvalidoError extends Error {
  constructor() {
    super("El código de SKU no puede estar vacío.");
    this.name = "SkuCodigoInvalidoError";
  }
}

// La llave de la maestra. Mismo criterio en los dos lados del cruce:
// el SKU de la publicación de ML y el de la importación.
export function normalizarSkuCodigo(codigo: string): string {
  const normalizado = codigo.trim().toUpperCase();
  if (!normalizado) throw new SkuCodigoInvalidoError();
  return normalizado;
}

function precioMinimo(valor: Monto | undefined, campo: string): string | null | undefined {
  if (valor === undefined) return undefined;
  const monto = validarMonto(valor, campo);
  return monto !== null && esCero(monto) ? null : monto;
}

function monto(valor: Monto | undefined, campo: string): string | null | undefined {
  return valor === undefined ? undefined : validarMonto(valor, campo);
}

// Solo los campos que vinieron: undefined = no tocar; null = vaciar.
function normalizarDatos(datos: DatosCostoSku) {
  const salida = {
    nombreProducto: datos.nombreProducto === undefined ? undefined : datos.nombreProducto?.trim() || null,
    costo: monto(datos.costo, "Costo"),
    empaque: monto(datos.empaque, "Empaque"),
    envioAgencia: monto(datos.envioAgencia, "Envío agencia"),
    precioMinimoUnidad: precioMinimo(datos.precioMinimoUnidad, "Precio mínimo por unidad"),
    precioMinimoComboX2: precioMinimo(datos.precioMinimoComboX2, "Precio mínimo combo x2"),
    precioMinimoComboX3: precioMinimo(datos.precioMinimoComboX3, "Precio mínimo combo x3"),
    precioVenta: monto(datos.precioVenta, "Precio de venta"),
    terceroId: datos.terceroId,
  };
  return Object.fromEntries(Object.entries(salida).filter(([, v]) => v !== undefined)) as Partial<
    Record<keyof typeof salida, string | null>
  >;
}

type CamposAuditados =
  | "costo"
  | "empaque"
  | "envioAgencia"
  | "precioMinimoUnidad"
  | "precioMinimoComboX2"
  | "precioMinimoComboX3"
  | "precioVenta"
  | "terceroId";

function textoAuditoria(fila: Partial<Record<CamposAuditados, string | null>>): string {
  return [
    `costo=${fila.costo ?? ""}`,
    `empaque=${fila.empaque ?? ""}`,
    `envio_agencia=${fila.envioAgencia ?? ""}`,
    `min1=${fila.precioMinimoUnidad ?? ""}`,
    `min2=${fila.precioMinimoComboX2 ?? ""}`,
    `min3=${fila.precioMinimoComboX3 ?? ""}`,
    `precio_venta=${fila.precioVenta ?? ""}`,
    `tercero=${fila.terceroId ?? ""}`,
  ].join(" ");
}

function esFkViolada(e: unknown): boolean {
  const error = e as { code?: string; cause?: { code?: string } };
  return error.code === "23503" || error.cause?.code === "23503";
}

// Crea la fila del SKU o actualiza la que ya existe. No exige que el
// SKU esté en `skus`.
export async function guardarCostoSku(entrada: {
  empresaId: string;
  usuarioId: string;
  skuCodigo: string;
  datos: DatosCostoSku;
  fuente?: FuenteCosto;
}): Promise<{ id: string }> {
  const skuCodigo = normalizarSkuCodigo(entrada.skuCodigo);
  const datos = normalizarDatos(entrada.datos);
  const fuente = entrada.fuente ?? "manual";

  try {
    return await dbComoEmpresa(entrada.empresaId, async (tx) => {
      const [previa] = await tx
        .select()
        .from(costosSku)
        .where(and(eq(costosSku.empresaId, entrada.empresaId), eq(costosSku.skuCodigo, skuCodigo)));

      let id: string;
      if (!previa) {
        const [fila] = await tx
          .insert(costosSku)
          .values({ empresaId: entrada.empresaId, skuCodigo, ...datos, fuente, actualizadoPor: entrada.usuarioId })
          .returning({ id: costosSku.id });
        id = fila.id;
      } else {
        id = previa.id;
        await tx
          .update(costosSku)
          .set({ ...datos, fuente, actualizadoTs: new Date(), actualizadoPor: entrada.usuarioId })
          .where(eq(costosSku.id, id));
      }

      await registrarAuditoria(tx, {
        empresaId: entrada.empresaId,
        usuarioId: entrada.usuarioId,
        actorTipo: "persona",
        accion: previa ? "modificar" : "crear",
        entidad: "costo_sku",
        entidadId: id,
        detalle: `${previa ? "Cambió" : "Cargó"} los costos del SKU ${skuCodigo}${fuente === "archivo" ? " (desde archivo)" : ""}.`,
        valorAnterior: previa ? textoAuditoria(previa) : undefined,
        valorNuevo: textoAuditoria({ ...(previa ?? {}), ...datos }),
      });
      return { id };
    });
  } catch (e) {
    // La FK compuesta (empresa_id, tercero_id) rechaza un tercero de
    // otra empresa aunque el id exista.
    if (esFkViolada(e)) throw new TerceroNoEncontradoError();
    throw e;
  }
}

export async function leerCostoSku(empresaId: string, skuCodigo: string) {
  const codigo = normalizarSkuCodigo(skuCodigo);
  const [fila] = await dbComoEmpresa(empresaId, (tx) =>
    tx
      .select({ costo: costosSku, empaqueProveedor: terceros.empaque })
      .from(costosSku)
      .leftJoin(terceros, and(eq(terceros.id, costosSku.terceroId), eq(terceros.empresaId, costosSku.empresaId)))
      .where(and(eq(costosSku.empresaId, empresaId), eq(costosSku.skuCodigo, codigo)))
  );
  return fila ? { ...fila.costo, empaqueProveedor: fila.empaqueProveedor } : null;
}

export type PackingEfectivo =
  | { valor: string; origen: "sku" | "proveedor"; sinDato: false }
  // Ni el SKU ni su proveedor tienen packing: el motor pone $0 y avisa
  // empaque_sin_dato (#152).
  | { valor: "0.00"; origen: "sin_dato"; sinDato: true };

// Packing efectivo = el propio del SKU; si está vacío, el de su
// proveedor; si los dos están vacíos (o no hay proveedor), sin dato.
// Un 0 en cualquiera de los dos es un $0 real, no "sin dato".
export function packingEfectivo(empaqueSku: string | null, empaqueProveedor: string | null): PackingEfectivo {
  if (empaqueSku !== null) return { valor: empaqueSku, origen: "sku", sinDato: false };
  if (empaqueProveedor !== null) return { valor: empaqueProveedor, origen: "proveedor", sinDato: false };
  return { valor: "0.00", origen: "sin_dato", sinDato: true };
}

export type CostosParaUtilidad =
  // Sin fila en la maestra o con costo vacío: la venta queda fuera de
  // la utilidad y se alerta. Un costo 0.00 NO cae acá.
  | { sinCosto: true; packing: PackingEfectivo }
  | { sinCosto: false; costo: string; envioAgencia: string | null; packing: PackingEfectivo };

// Lo que necesita el motor de utilidad de un SKU. Sin cálculo de
// utilidad acá (#129/#130 congelan la foto de cada venta).
export async function costosParaUtilidad(empresaId: string, skuCodigo: string): Promise<CostosParaUtilidad> {
  const fila = await leerCostoSku(empresaId, skuCodigo);
  if (!fila) return { sinCosto: true, packing: packingEfectivo(null, null) };
  const packing = packingEfectivo(fila.empaque, fila.empaqueProveedor);
  if (fila.costo === null) return { sinCosto: true, packing };
  return { sinCosto: false, costo: fila.costo, envioAgencia: fila.envioAgencia, packing };
}
