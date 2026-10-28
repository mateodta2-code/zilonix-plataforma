import { NextResponse } from "next/server";
import { SinPermisoError } from "@/lib/permisos";
import { CandadoDeRenovacionError, CuentaDesconectadaError, CuentaMlNoEncontradaError, RenovacionTokenFallidaError } from "@/lib/ml/cuentas";
import { LimiteMercadoLibreError, MlNoAutorizadoError, MlNoDisponibleError, MlRespuestaInesperadaError, MlSinPermisoAppError } from "@/lib/ml/cliente";

// Code review de Pablo (origin/main...mateo/feat-publicar-ux, punto 2)
// sobre las 3 rutas de categoría/características — no es una ruta en
// sí (no se llama route.ts/page.tsx/actions.ts a propósito, para que
// scripts/verificar-permisos.test.ts nunca la vea como una ruta que
// clasificar): helpers compartidos por las 3.

// Mismo valor que PATRON_UUID en app/api/ml/clip/route.ts (cuentaId es
// un UUID real, columna `id` de cuentas_ml) — no se importa de ahí
// porque un route.ts nunca debería exportar símbolos para que otro
// archivo los use (Next solo reconoce ahí los verbos HTTP + un puñado
// de configs). Mismo patrón, declarado dos veces a propósito.
export const PATRON_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// BLOQUEANTE evitado (punto 2 de la revisión): antes, cuentaId
// llegaba tal cual a obtenerAccessTokenVigente sin validar el
// FORMATO — un id mal formado ahora se rechaza ANTES de tocar la
// base, mismo criterio que exigirId() en lib/ml/cliente.ts y la
// validación adelantada de app/api/ml/clip/route.ts.
export function respuestaSiCuentaIdInvalido(cuentaId: string | null): NextResponse | null {
  if (!cuentaId || !PATRON_UUID.test(cuentaId)) {
    return NextResponse.json({ error: "cuentaId inválido." }, { status: 400 });
  }
  return null;
}

// Mismo criterio, para categoryId/categoriaId (opcionales en 2 de las
// 3 rutas) — `patron` es PATRON_ID_CATEGORIA de lib/ml/cliente.ts,
// pasado por el llamador (nunca redefinido acá, una sola fuente de
// verdad para ese patrón). Vacío/ausente no es un error — esas rutas
// aceptan sin categoryId (detección automática por título).
export function respuestaSiCategoryIdInvalido(categoryId: string | null, patron: RegExp): NextResponse | null {
  if (categoryId != null && categoryId !== "" && !patron.test(categoryId)) {
    return NextResponse.json({ error: "categoryId inválido." }, { status: 400 });
  }
  return null;
}

// Nunca error.message crudo (puede venir de una excepción que nadie
// anticipó): se mapea por `instanceof` a un status+mensaje FIJO y
// conocido — mismo criterio que codigoDeErrorDeSubida() en
// app/api/ml/clip/route.ts, acá devolviendo JSON en vez de un redirect
// con query param. `SinPermisoError` se atrapa PRIMERO en cada ruta
// (ver más abajo) para no llegar nunca hasta acá con un 500 — esta
// función solo mapea lo que puede pasar DESPUÉS de superar el permiso
// (token/cuenta/Mercado Libre).
export function respuestaDeErrorMl(error: unknown): NextResponse {
  if (error instanceof CuentaMlNoEncontradaError) {
    return NextResponse.json({ error: "No se encontró esa cuenta de Mercado Libre." }, { status: 404 });
  }
  if (error instanceof CuentaDesconectadaError) {
    return NextResponse.json({ error: "Esta cuenta de Mercado Libre está desconectada — hay que reconectarla." }, { status: 409 });
  }
  if (error instanceof CandadoDeRenovacionError) {
    return NextResponse.json({ error: "Otro proceso ya está renovando el token de esta cuenta — intentá de nuevo en unos segundos." }, { status: 409 });
  }
  if (error instanceof RenovacionTokenFallidaError) {
    return NextResponse.json({ error: "No se pudo renovar la conexión con Mercado Libre — puede que haya que reconectar la cuenta." }, { status: 409 });
  }
  if (error instanceof MlNoAutorizadoError) {
    return NextResponse.json({ error: "La conexión con esta cuenta de Mercado Libre ya no es válida — hay que reconectarla." }, { status: 409 });
  }
  if (error instanceof LimiteMercadoLibreError) {
    return NextResponse.json({ error: "Mercado Libre está limitando las consultas — intentá de nuevo en un minuto." }, { status: 429 });
  }
  if (error instanceof MlSinPermisoAppError || error instanceof MlNoDisponibleError || error instanceof MlRespuestaInesperadaError) {
    return NextResponse.json({ error: "Mercado Libre no respondió esta consulta — intentá de nuevo en un momento." }, { status: 502 });
  }
  // Fallback genérico — incluye los `new Error(...)` propios de
  // lib/ml/publicar.ts (ej. "no se encontró categoría para..."): son
  // mensajes ya curados por ese archivo, pero esta función no puede
  // distinguirlos de una excepción inesperada solo por `instanceof
  // Error` — nunca se reenvía ese texto tal cual. El detalle real
  // (recortado) solo va al log del servidor, nunca a la respuesta.
  console.error("[app/api/ml/publicar] error inesperado:", error instanceof Error ? error.message.slice(0, 500) : String(error));
  return NextResponse.json({ error: "No se pudo completar la consulta a Mercado Libre." }, { status: 502 });
}

// `SinPermisoError` atrapado por cada ruta y mapeado a 403 explícito
// (mismo criterio que app/api/ml/clip/route.ts, que lo atrapa para
// volver con `?error=sin_permiso` en vez de dejarlo subir) — antes
// esto nunca se atrapaba y requierePermiso() lanzaba directo hasta
// que Next lo convertía en un 500 genérico sin ningún JSON claro.
export function respuestaSiSinPermiso(error: unknown): NextResponse | null {
  if (error instanceof SinPermisoError) {
    return NextResponse.json({ error: "No tenés permiso para esto." }, { status: 403 });
  }
  return null;
}
