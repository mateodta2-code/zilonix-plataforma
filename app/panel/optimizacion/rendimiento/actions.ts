"use server";

import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { and, eq, inArray, isNull } from "drizzle-orm";
import { dbComoEmpresa } from "@/db/empresa-context";
import { cuentasMl, publicaciones } from "@/db/schema";
import { listarEmpresasDeUsuario } from "@/lib/empresas";
import { calidadItemMl, categoriasItemsMl, competenciaItemMl, PATRON_ID_PRODUCTO_O_ITEM, referenciaPrecioItemMl, visitasItemMl } from "@/lib/ml/cliente";
import { obtenerAccessTokenVigente } from "@/lib/ml/cuentas";
import { leerBandejaPreguntas, motivoCuentaSinRevisar } from "@/lib/ml/preguntas";
import { hastaExclusivoIso, leerPeriodoLista } from "@/lib/optimizacion/periodoLista";
import type { SenalesItem } from "@/lib/optimizacion/accionables";
import { minutosDesde } from "@/lib/preguntas/tiempo";
import { requierePermiso, SinPermisoError } from "@/lib/permisos";
import { obtenerOCrearUsuarioActual } from "@/lib/usuarios";

// Optimización · Rendimiento — lo que sí sale de Mercado Libre (solo GET):
// visitas por publicación y su categoría. Pide inventario.consultar.
//
// Topes por carga de la página (rate limiting): categorías, 1 llamada del
// cliente con ≤ 100 ids = 5 multigets de 20; visitas, ≤ 100 publicaciones,
// 1 llamada a ML cada una, de a 3 (MAXIMO_VISITAS_POR_PEDIDO). Total: ≤ 105.
//
// «Qué hacer primero» (accionables): contexto = 1 lectura a la base (stock y
// precio) + la bandeja de preguntas (1 búsqueda y 1 de reclamos por cuenta
// de la empresa, más 1 por motivo de reclamo distinto); señales = ≤ 10
// publicaciones × 3 lecturas (calidad, referencia de precio, competencia),
// de a 3 publicaciones por pedido, sin caché. Total: ≤ 30 + la bandeja.

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAXIMO_PUBLICACIONES_RENDIMIENTO = 100;
const MAXIMO_VISITAS_POR_PEDIDO = 3;

async function cuentaPermitida(cuentaMlId: string) {
  const usuario = await obtenerOCrearUsuarioActual();
  if (!usuario) redirect("/sign-in");
  const propias = await listarEmpresasDeUsuario(usuario.id);
  const empresa = propias.find((e) => e.id === cookies().get("empresa_actual")?.value) ?? propias[0];
  if (!empresa) redirect("/crear-empresa");
  try {
    await requierePermiso(usuario.id, empresa.id, "inventario", "consultar");
  } catch (error) {
    if (!(error instanceof SinPermisoError)) throw error;
    return { ok: false as const, aviso: "Tu rol no tiene acceso a Optimización." };
  }
  if (typeof cuentaMlId !== "string" || !UUID.test(cuentaMlId)) return { ok: false as const, aviso: "Esa cuenta de Mercado Libre ya no está conectada a esta empresa." };
  const [cuenta] = await dbComoEmpresa(empresa.id, (tx) =>
    tx
      .select({ id: cuentasMl.id, siteId: cuentasMl.siteId })
      .from(cuentasMl)
      .where(and(eq(cuentasMl.id, cuentaMlId), eq(cuentasMl.empresaId, empresa.id), isNull(cuentasMl.desconectadaTs)))
  );
  if (!cuenta) return { ok: false as const, aviso: "Esa cuenta de Mercado Libre ya no está conectada a esta empresa." };
  try {
    return { ok: true as const, token: await obtenerAccessTokenVigente(empresa.id, cuenta.id), empresaId: empresa.id, usuarioId: usuario.id, siteId: cuenta.siteId };
  } catch (error) {
    return { ok: false as const, aviso: motivoCuentaSinRevisar(error) };
  }
}

function idsValidos(ids: unknown, maximo: number): string[] {
  return (Array.isArray(ids) ? ids : []).filter((i): i is string => typeof i === "string" && PATRON_ID_PRODUCTO_O_ITEM.test(i)).slice(0, maximo);
}

export type ResultadoCategorias = { ok: true; categorias: Record<string, string> } | { ok: false; aviso: string };

export async function categoriasRendimientoAction(entrada: { cuentaMlId: string; ids: string[] }): Promise<ResultadoCategorias> {
  const ctx = await cuentaPermitida(entrada.cuentaMlId);
  if (!ctx.ok) return ctx;
  try {
    const mapa = await categoriasItemsMl(idsValidos(entrada.ids, MAXIMO_PUBLICACIONES_RENDIMIENTO), ctx.token);
    return { ok: true, categorias: Object.fromEntries(mapa) };
  } catch (error) {
    // Solo el nombre del error: nunca la respuesta de Mercado Libre.
    console.warn(`[rendimiento] categorías: ${error instanceof Error ? error.name : "error"}`);
    return { ok: false, aviso: "No se pudieron traer las categorías. Los semáforos usan la mediana de la cuenta." };
  }
}

export type ResultadoVisitasRendimiento = { ok: true; visitas: Record<string, number | null> } | { ok: false; aviso: string };

export async function visitasRendimientoAction(entrada: {
  cuentaMlId: string;
  ids: string[];
  dias?: number;
  periodo?: { desde?: string; hasta?: string };
}): Promise<ResultadoVisitasRendimiento> {
  const periodo = leerPeriodoLista({ dias: entrada.dias, desde: entrada.periodo?.desde, hasta: entrada.periodo?.hasta }, new Date());
  // Igual que la lista: «hoy» y el rango terminan el día siguiente (ending es exclusivo).
  const ending = periodo.clave === "hoy" || periodo.clave === "rango" ? hastaExclusivoIso(periodo) : undefined;
  const ctx = await cuentaPermitida(entrada.cuentaMlId);
  if (!ctx.ok) return ctx;
  const visitas: Record<string, number | null> = {};
  // Una publicación que falla queda en null; no tumba las otras.
  await Promise.all(
    idsValidos(entrada.ids, MAXIMO_VISITAS_POR_PEDIDO).map(async (id) => {
      visitas[id] = await visitasItemMl(id, ctx.token, periodo.dias, ending).catch(() => null);
    })
  );
  return { ok: true, visitas };
}

// ---------- Qué hacer primero ----------

const MAXIMO_SENALES_POR_PEDIDO = 3;
const MINUTOS_PREGUNTA_VIEJA = 24 * 60;

export type ContextoAccionable = { stock: number | null; precio: number | null; preguntasSinResponder: number };
export type ResultadoContextoAccionables = { ok: true; contexto: Record<string, ContextoAccionable>; avisos: string[] } | { ok: false; aviso: string };

// Stock y precio salen de lo que Seller ya importó (no de Mercado Libre);
// el precio solo con ventas/consultar. Las preguntas de más de 24 h, de la
// bandeja, filtradas por esta cuenta (también con ventas/consultar, como /panel/preguntas).
export async function contextoAccionablesAction(entrada: { cuentaMlId: string; ids: string[] }): Promise<ResultadoContextoAccionables> {
  const ctx = await cuentaPermitida(entrada.cuentaMlId);
  if (!ctx.ok) return ctx;
  let verVentas = true;
  try {
    await requierePermiso(ctx.usuarioId, ctx.empresaId, "ventas", "consultar");
  } catch (error) {
    if (!(error instanceof SinPermisoError)) throw error;
    verVentas = false;
  }
  const contexto: Record<string, ContextoAccionable> = {};
  const avisos: string[] = [];
  const ids = idsValidos(entrada.ids, MAXIMO_PUBLICACIONES_RENDIMIENTO);
  try {
    const filas = ids.length
      ? await dbComoEmpresa(ctx.empresaId, (tx) =>
          tx
            .select({ id: publicaciones.publicacionIdExterno, stock: publicaciones.stock, precio: publicaciones.precio })
            .from(publicaciones)
            .where(and(eq(publicaciones.empresaId, ctx.empresaId), eq(publicaciones.cuentaMlId, entrada.cuentaMlId), inArray(publicaciones.publicacionIdExterno, ids)))
        )
      : [];
    for (const f of filas) contexto[f.id] = { stock: f.stock, precio: verVentas ? Number(f.precio) : null, preguntasSinResponder: 0 };
  } catch (error) {
    console.warn(`[rendimiento] accionables, stock: ${error instanceof Error ? error.name : "error"}`);
    avisos.push("No se pudo leer el stock: sin la regla «Sin stock».");
  }
  if (verVentas) {
    try {
      const bandeja = await leerBandejaPreguntas(ctx.empresaId);
      const ahora = new Date();
      for (const p of bandeja.preguntas) {
        if (p.cuentaMlId !== entrada.cuentaMlId || !p.itemId) continue;
        const minutos = minutosDesde(p.fecha, ahora);
        if (minutos === null || minutos <= MINUTOS_PREGUNTA_VIEJA) continue;
        const c = (contexto[p.itemId] ??= { stock: null, precio: null, preguntasSinResponder: 0 });
        c.preguntasSinResponder += 1;
      }
    } catch (error) {
      console.warn(`[rendimiento] accionables, preguntas: ${error instanceof Error ? error.name : "error"}`);
      avisos.push("No se pudieron leer las preguntas pendientes.");
    }
  }
  return { ok: true, contexto, avisos };
}

export type ResultadoSenalesAccionables = { ok: true; senales: Record<string, SenalesItem> } | { ok: false; aviso: string };

// Solo GET: calidad, referencia de precio y competencia de ≤ 3 publicaciones.
// Una lectura que falla queda sin dato; no tumba las demás.
export async function senalesAccionablesAction(entrada: { cuentaMlId: string; ids: string[] }): Promise<ResultadoSenalesAccionables> {
  const ctx = await cuentaPermitida(entrada.cuentaMlId);
  if (!ctx.ok) return ctx;
  const senales: Record<string, SenalesItem> = {};
  await Promise.all(
    idsValidos(entrada.ids, MAXIMO_SENALES_POR_PEDIDO).map(async (id) => {
      const [calidad, referencia, competencia] = [
        await calidadItemMl(id, ctx.token).catch(() => null),
        await referenciaPrecioItemMl(id, ctx.token).catch(() => null),
        await competenciaItemMl(id, ctx.token, ctx.siteId).catch(() => null),
      ];
      senales[id] = {
        calidad: calidad ? { nivel: calidad.nivel, pendientes: calidad.pendientes } : null,
        referenciaEstado: referencia?.estado ?? null,
        referenciaPrecioActual: referencia?.precioActual ?? null,
        referenciaPrecioSugerido: referencia?.precioSugerido ?? null,
        referenciaDiferencia: referencia?.diferenciaPorcentaje ?? null,
        competenciaEstado: competencia?.estado ?? null,
        competenciaPrecioParaGanar: competencia?.precioParaGanar ?? null,
      };
    })
  );
  return { ok: true, senales };
}
