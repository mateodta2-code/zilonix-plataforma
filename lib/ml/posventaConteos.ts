// Posventa-0 (Refs #647) — contadores baratos de las pestañas de
// Posventa. Una llamada por cuenta y por contador, solo lectura. Si una
// lectura falla, ese contador es null (la pestaña se muestra sin número).
// Nunca se guarda ni se registra contenido de ML: solo el nombre del error.

import { buscarReclamosAbiertosMl, pedirLecturaMl } from "@/lib/ml/cliente";
import { listarCuentasConectadas, obtenerAccessTokenVigente } from "@/lib/ml/cuentas";

export type ConteosPosventa = { reclamos: number | null; mensajes: number | null };

// GET /messages/unread?role=seller&tag=post_sale. La forma exacta de la
// respuesta no se adivina: se acepta un `total` numérico o la suma de
// `count` de `results`; cualquier otra forma da null (sin número).
export function leerMensajesPendientesMl(data: unknown): number | null {
  if (!data || typeof data !== "object") return null;
  const obj = data as Record<string, unknown>;
  if (typeof obj.total === "number" && Number.isFinite(obj.total) && obj.total >= 0) return Math.floor(obj.total);
  if (Array.isArray(obj.results)) {
    let suma = 0;
    for (const r of obj.results) {
      const c = r && typeof r === "object" ? (r as Record<string, unknown>).count : undefined;
      if (typeof c !== "number" || !Number.isFinite(c) || c < 0) return null;
      suma += Math.floor(c);
    }
    return suma;
  }
  return null;
}

// Suma por cuenta; si alguna cuenta falla, el total no es confiable → null.
export function sumarConteos(parciales: (number | null)[]): number | null {
  if (parciales.length === 0) return 0;
  let total = 0;
  for (const p of parciales) {
    if (p === null) return null;
    total += p;
  }
  return total;
}

async function mensajesPendientesDeCuenta(token: string): Promise<number | null> {
  // Solo conteo: este recurso no marca nada como leído.
  const resp = await pedirLecturaMl<unknown>("/messages/unread", token, { query: "?role=seller&tag=post_sale" });
  return resp.ok ? leerMensajesPendientesMl(resp.data) : null;
}

export async function leerConteosPosventa(empresaId: string): Promise<ConteosPosventa> {
  let cuentas;
  try {
    cuentas = (await listarCuentasConectadas(empresaId)).filter((c) => !c.desconectadaTs);
  } catch (error) {
    console.warn(`[lib/ml/posventaConteos] cuentas: ${error instanceof Error ? error.name : "error"}`);
    return { reclamos: null, mensajes: null };
  }
  const reclamos: (number | null)[] = [];
  const mensajes: (number | null)[] = [];
  // En serie, como la bandeja: en paralelo se pisaba el límite de ML.
  for (const cuenta of cuentas) {
    let token: string;
    try {
      token = await obtenerAccessTokenVigente(empresaId, cuenta.id);
    } catch (error) {
      console.warn(`[lib/ml/posventaConteos] cuenta ${cuenta.id}: ${error instanceof Error ? error.name : "error"}`);
      reclamos.push(null);
      mensajes.push(null);
      continue;
    }
    try {
      const abiertos = await buscarReclamosAbiertosMl(token);
      reclamos.push(abiertos.reclamos.length);
    } catch (error) {
      console.warn(`[lib/ml/posventaConteos] reclamos ${cuenta.id}: ${error instanceof Error ? error.name : "error"}`);
      reclamos.push(null);
    }
    try {
      mensajes.push(await mensajesPendientesDeCuenta(token));
    } catch (error) {
      console.warn(`[lib/ml/posventaConteos] mensajes ${cuenta.id}: ${error instanceof Error ? error.name : "error"}`);
      mensajes.push(null);
    }
  }
  return { reclamos: sumarConteos(reclamos), mensajes: sumarConteos(mensajes) };
}
