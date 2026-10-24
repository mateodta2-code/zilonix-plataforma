import { obtenerCuentaMlActiva, obtenerAccessTokenVigente } from "@/lib/ml/cuentas";
import { diagnosticoCatalogoMl, diagnosticoItemMl, diagnosticoVendedorMl, type DiagnosticoCatalogoMl, type DiagnosticoItemMl, type DiagnosticoVendedorMl } from "@/lib/ml/cliente";

// Issue #175 — "antes de escribir el lector, confirma en vivo qué
// endpoints responden": esta capa resuelve el token de la cuenta ML
// PROPIA conectada a la empresa (mismo camino que investigacion.ts,
// obtenerCuentaMlActiva + obtenerAccessTokenVigente) y llama a las
// funciones de diagnóstico de lib/ml/cliente.ts — nunca un fetch
// suelto acá, y el token nunca sale de esta función hacia el llamador
// (page.tsx/actions.ts solo reciben el resultado ya armado).
export class SinCuentaMlParaDiagnosticoError extends Error {
  constructor() {
    super("Esta empresa todavía no tiene ninguna cuenta de Mercado Libre conectada — hace falta una cuenta propia conectada para poder probar contra la API real.");
    this.name = "SinCuentaMlParaDiagnosticoError";
  }
}

async function obtenerTokenPropio(empresaId: string): Promise<string> {
  const cuenta = await obtenerCuentaMlActiva(empresaId);
  if (!cuenta) throw new SinCuentaMlParaDiagnosticoError();
  return obtenerAccessTokenVigente(empresaId, cuenta.id);
}

export async function diagnosticarItem(empresaId: string, itemId: string): Promise<DiagnosticoItemMl> {
  const token = await obtenerTokenPropio(empresaId);
  return diagnosticoItemMl(itemId, token);
}

export async function diagnosticarVendedor(empresaId: string, sellerId: string): Promise<DiagnosticoVendedorMl> {
  const token = await obtenerTokenPropio(empresaId);
  return diagnosticoVendedorMl(sellerId, token);
}

export async function diagnosticarCatalogo(empresaId: string, productId: string): Promise<DiagnosticoCatalogoMl> {
  const token = await obtenerTokenPropio(empresaId);
  return diagnosticoCatalogoMl(productId, token);
}
