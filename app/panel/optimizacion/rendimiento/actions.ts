"use server";

import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { and, eq, isNull } from "drizzle-orm";
import { dbComoEmpresa } from "@/db/empresa-context";
import { cuentasMl } from "@/db/schema";
import { listarEmpresasDeUsuario } from "@/lib/empresas";
import { categoriasItemsMl, PATRON_ID_PRODUCTO_O_ITEM, visitasItemMl } from "@/lib/ml/cliente";
import { obtenerAccessTokenVigente } from "@/lib/ml/cuentas";
import { motivoCuentaSinRevisar } from "@/lib/ml/preguntas";
import { hastaExclusivoIso, leerPeriodoLista } from "@/lib/optimizacion/periodoLista";
import { requierePermiso, SinPermisoError } from "@/lib/permisos";
import { obtenerOCrearUsuarioActual } from "@/lib/usuarios";

// Optimización · Rendimiento — lo que sí sale de Mercado Libre (solo GET):
// visitas por publicación y su categoría. Pide inventario.consultar.
//
// Topes por carga de la página (rate limiting): categorías, 1 llamada del
// cliente con ≤ 100 ids = 5 multigets de 20; visitas, ≤ 100 publicaciones,
// 1 llamada a ML cada una, de a 3 (MAXIMO_VISITAS_POR_PEDIDO). Total: ≤ 105.

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
      .select({ id: cuentasMl.id })
      .from(cuentasMl)
      .where(and(eq(cuentasMl.id, cuentaMlId), eq(cuentasMl.empresaId, empresa.id), isNull(cuentasMl.desconectadaTs)))
  );
  if (!cuenta) return { ok: false as const, aviso: "Esa cuenta de Mercado Libre ya no está conectada a esta empresa." };
  try {
    return { ok: true as const, token: await obtenerAccessTokenVigente(empresa.id, cuenta.id) };
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
