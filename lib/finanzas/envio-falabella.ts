// Issue #422 — tipo de envío de una orden de Falabella, para saber si se
// resta el envío agencia (el domiciliario cobra por llevar el paquete a
// Servientrega). Función pura: TODA la regla vive acá para corregirla en un
// solo sitio cuando veamos los valores reales de GetOrderItems (la consulta
// para revisarlos va en el PR).
//
// Regla (Sharel, issue #422), por orden:
// 1. Envío propio: algún ítem trae `ShipmentProvider`/`ShippingProviderType`
//    con «directo» (p. ej. `ibisdirecto`) o el reporte dice «Pago por envío
//    directo». No se resta envío agencia.
// 2. Fulfillment: algún ítem trae `ShippingType` «Own Warehouse» o que
//    contenga «fulfillment». No se resta envío agencia.
// 3. Agencia: TODOS los ítems traen `ShippingType` «Dropshipping» o «Cross
//    docking». Se resta el mayor envío agencia de los SKU.
// 4. Desconocido: cualquier otro caso (sin ítems, `ShippingType` vacío o un
//    valor que no reconocemos). NO se resta envío agencia: nunca se asume.
// El empaque se resta en los cuatro casos.

export type TipoEnvioFalabella = "agencia" | "propio" | "fulfillment" | "desconocido";

export interface ItemEnvioFalabella {
  // `ShippingType` de GetOrderItems, tal cual.
  tipoEnvio?: string | null;
  // `ShipmentProvider` y `ShippingProviderType`, tal cual.
  proveedor?: string | null;
  tipoProveedor?: string | null;
}

// Minúsculas, sin tildes, sin espacios, guiones ni guiones bajos:
// «Cross docking», «cross_docking» y «CrossDocking» quedan iguales.
function plano(texto: string | null | undefined): string {
  return (texto ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[\s_-]+/g, "");
}

// El ítem lo despacha el vendedor con su propio domiciliario.
export function esProveedorDirecto(item: ItemEnvioFalabella): boolean {
  return plano(item.proveedor).includes("directo") || plano(item.tipoProveedor).includes("directo");
}

const TIPOS_AGENCIA = new Set(["dropshipping", "crossdocking"]);

function esFulfillment(tipo: string): boolean {
  return tipo === "ownwarehouse" || tipo.includes("fulfillment");
}

export function clasificarEnvioFalabella(entrada: {
  items: readonly ItemEnvioFalabella[];
  // El reporte de transacciones trae «Pago por envío directo».
  envioDirectoReporte?: boolean;
}): TipoEnvioFalabella {
  const { items } = entrada;
  if (entrada.envioDirectoReporte || items.some(esProveedorDirecto)) return "propio";
  const tipos = items.map((i) => plano(i.tipoEnvio));
  if (tipos.some(esFulfillment)) return "fulfillment";
  if (tipos.length > 0 && tipos.every((t) => TIPOS_AGENCIA.has(t))) return "agencia";
  return "desconocido";
}
