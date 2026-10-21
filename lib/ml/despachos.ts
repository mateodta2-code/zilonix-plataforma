import { and, eq, isNull } from "drizzle-orm";
import { dbComoEmpresa } from "@/db/empresa-context";
import { cuentasMl, despachosMl } from "@/db/schema";
import { obtenerAccessTokenVigente } from "@/lib/ml/cuentas";

// Tarea 2.10 — formato de petición y reglas de negocio confirmados
// contra el código real ya en producción del Zilonix OS actual
// (lib/mercadolibre-despachos.js) — no inventado.

// Solo en estos estados Mercado Libre deja imprimir/reimprimir la
// guía. Una vez el transportador recoge el paquete, es un bloqueo
// real y permanente de ML, no algo que se pueda evitar por API.
const ESTADOS_IMPRIMIBLES = ["pending", "handling", "ready_to_ship"];
// El "status" puede quedarse en ready_to_ship un buen rato DESPUÉS de
// que ya lo recogieron — lo que cambia de inmediato es el substatus.
const SUBESTADOS_YA_SALIO = ["picked_up", "dropped_off", "out_for_delivery", "at_the_door"];

function calcularImprimible(status: string | null, substatus: string | null): boolean {
  if (status && !ESTADOS_IMPRIMIBLES.includes(status)) return false;
  if (substatus && SUBESTADOS_YA_SALIO.includes(substatus)) return false;
  return true;
}

type ShipmentMl = { status: string | null; substatus: string | null; logistic_type: string | null };

// Trae el envío real y guarda/actualiza la fila de despachos_ml — se
// llama al importar un pedido (tarea 2.5) y cuando llega un aviso de
// envío nuevo.
export async function sincronizarDespacho(empresaId: string, cuentaId: string, pedidoId: string, shipmentIdExterno: string): Promise<void> {
  const accessToken = await obtenerAccessTokenVigente(empresaId, cuentaId);
  const res = await fetch(`https://api.mercadolibre.com/shipments/${shipmentIdExterno}`, { headers: { Authorization: `Bearer ${accessToken}` } });
  if (!res.ok) throw new Error(`Mercado Libre respondió ${res.status} al traer el envío ${shipmentIdExterno}.`);
  const envio: ShipmentMl = await res.json();

  const logisticType = ["self_service", "xd_drop_off", "cross_docking", "fulfillment"].includes(envio.logistic_type ?? "")
    ? (envio.logistic_type as "self_service" | "xd_drop_off" | "cross_docking" | "fulfillment")
    : "otro";
  const imprimible = logisticType !== "fulfillment" && calcularImprimible(envio.status, envio.substatus);

  await dbComoEmpresa(empresaId, (tx) =>
    tx
      .insert(despachosMl)
      .values({
        empresaId,
        pedidoId,
        cuentaMlId: cuentaId,
        shipmentIdExterno,
        logisticType,
        status: envio.status,
        substatus: envio.substatus,
        imprimible,
      })
      .onConflictDoUpdate({
        target: [despachosMl.empresaId, despachosMl.shipmentIdExterno],
        set: { status: envio.status, substatus: envio.substatus, logisticType, imprimible, actualizadoTs: new Date() },
      })
  );
}

export async function listarDespachosPendientes(empresaId: string) {
  return dbComoEmpresa(empresaId, (tx) =>
    tx.select().from(despachosMl).where(and(eq(despachosMl.empresaId, empresaId), eq(despachosMl.imprimible, true), isNull(despachosMl.etiquetaImpresaTs)))
  );
}

export class EtiquetaNoImprimibleError extends Error {
  constructor() {
    super("Mercado Libre ya no deja imprimir esta guía porque el transportador ya la recogió — es un bloqueo de Mercado Libre, no hay forma de saltarlo.");
    this.name = "EtiquetaNoImprimibleError";
  }
}

// API real: GET /shipment_labels?shipment_ids=X,Y,Z&response_type=pdf
// — acepta varios shipment_ids de una vez, confirmado en producción:
// esto ES la "impresión masiva" que pide la tarea, no hace falta
// armarla a mano pedido por pedido.
export async function obtenerEtiquetasPdf(empresaId: string, cuentaId: string, shipmentIdsExternos: string[]): Promise<ArrayBuffer> {
  const accessToken = await obtenerAccessTokenVigente(empresaId, cuentaId);
  const res = await fetch(`https://api.mercadolibre.com/shipment_labels?shipment_ids=${shipmentIdsExternos.join(",")}&response_type=pdf`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) {
    const texto = await res.text().catch(() => "");
    let datos: { failed_shipments?: { cause?: string }[]; cause?: string } | null = null;
    try {
      datos = JSON.parse(texto);
    } catch {
      /* no era JSON */
    }
    const causa = datos?.failed_shipments?.[0]?.cause ?? datos?.cause;
    if (causa === "NOT_PRINTABLE_STATUS") throw new EtiquetaNoImprimibleError();
    throw new Error(`No se pudo traer la guía (HTTP ${res.status}): ${texto.slice(0, 300)}`);
  }
  return res.arrayBuffer();
}

export async function marcarEtiquetasImpresas(empresaId: string, cuentaId: string, shipmentIdsExternos: string[]): Promise<void> {
  await dbComoEmpresa(empresaId, async (tx) => {
    for (const shipmentId of shipmentIdsExternos) {
      await tx
        .update(despachosMl)
        .set({ etiquetaImpresaTs: new Date() })
        .where(and(eq(despachosMl.empresaId, empresaId), eq(despachosMl.shipmentIdExterno, shipmentId), eq(despachosMl.cuentaMlId, cuentaId)));
    }
  });
}

export async function obtenerCuentaIdExterna(empresaId: string, cuentaId: string): Promise<string> {
  const [cuenta] = await dbComoEmpresa(empresaId, (tx) => tx.select({ cuentaIdExterna: cuentasMl.cuentaIdExterna }).from(cuentasMl).where(eq(cuentasMl.id, cuentaId)));
  if (!cuenta) throw new Error("Cuenta de Mercado Libre no encontrada.");
  return cuenta.cuentaIdExterna;
}
