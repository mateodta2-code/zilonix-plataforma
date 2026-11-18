"use server";

import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { and, eq, isNull } from "drizzle-orm";
import { dbComoEmpresa } from "@/db/empresa-context";
import { cuentasMl } from "@/db/schema";
import { registrarAuditoria } from "@/lib/auditoria";
import { listarEmpresasDeUsuario } from "@/lib/empresas";
import {
  actualizarItemMl,
  calidadItemMl,
  competenciaItemMl,
  LimiteMercadoLibreError,
  PATRON_ID_PRODUCTO_O_ITEM,
  visitasItemMl,
  type CalidadItemMl,
  type CompetenciaItemMl,
} from "@/lib/ml/cliente";
import { obtenerAccessTokenVigente } from "@/lib/ml/cuentas";
import { motivoCuentaSinRevisar } from "@/lib/ml/preguntas";
import { itemNoModificablePorRevision } from "@/lib/ml/publicar-reglas";
import { DIAS_METRICAS } from "@/lib/optimizacion/textos";
import { requierePermiso, SinPermisoError } from "@/lib/permisos";
import { obtenerOCrearUsuarioActual } from "@/lib/usuarios";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// Por pedido de la tabla: cada publicación son hasta 3 llamadas.
const MAXIMO_ITEMS_POR_PEDIDO = 10;
const EN_PARALELO = 3;

async function contexto(accion: "consultar" | "modificar") {
  const usuario = await obtenerOCrearUsuarioActual();
  if (!usuario) redirect("/sign-in");
  const propias = await listarEmpresasDeUsuario(usuario.id);
  const empresaIdCookie = cookies().get("empresa_actual")?.value;
  const empresa = propias.find((e) => e.id === empresaIdCookie) ?? propias[0];
  if (!empresa) redirect("/crear-empresa");
  try {
    await requierePermiso(usuario.id, empresa.id, "inventario", accion);
  } catch (error) {
    if (!(error instanceof SinPermisoError)) throw error;
    return null;
  }
  return { usuarioId: usuario.id, empresaId: empresa.id };
}

async function cuentaDeLaEmpresa(empresaId: string, cuentaMlId: string) {
  if (!UUID.test(cuentaMlId)) return null;
  const [cuenta] = await dbComoEmpresa(empresaId, (tx) =>
    tx
      .select({ id: cuentasMl.id, nickname: cuentasMl.nickname, siteId: cuentasMl.siteId })
      .from(cuentasMl)
      .where(and(eq(cuentasMl.id, cuentaMlId), eq(cuentasMl.empresaId, empresaId), isNull(cuentasMl.desconectadaTs)))
  );
  return cuenta ?? null;
}

export type MetricasPublicacion = {
  visitas: number | null;
  calidad: CalidadItemMl | null;
  // null si no es de catálogo o Mercado Libre no respondió.
  competencia: CompetenciaItemMl | null;
};

export type ResultadoMetricas = { ok: true; metricas: Record<string, MetricasPublicacion> } | { ok: false; aviso: string };

// Visitas de 7 días, calidad y competencia de hasta 10 publicaciones.
// Solo lectura. Una publicación que falla queda con sus datos en null.
export async function metricasPublicacionesAction(entrada: {
  cuentaMlId: string;
  items: { id: string; catalogo: boolean }[];
}): Promise<ResultadoMetricas> {
  const ctx = await contexto("consultar");
  if (!ctx) return { ok: false, aviso: "Tu rol no tiene acceso a Optimización." };
  const cuenta = await cuentaDeLaEmpresa(ctx.empresaId, entrada.cuentaMlId);
  if (!cuenta) return { ok: false, aviso: "Esa cuenta de Mercado Libre ya no está conectada a esta empresa." };
  const items = (Array.isArray(entrada.items) ? entrada.items : [])
    .filter((i) => typeof i?.id === "string" && PATRON_ID_PRODUCTO_O_ITEM.test(i.id))
    .slice(0, MAXIMO_ITEMS_POR_PEDIDO);

  let token: string;
  try {
    token = await obtenerAccessTokenVigente(ctx.empresaId, cuenta.id);
  } catch (error) {
    return { ok: false, aviso: motivoCuentaSinRevisar(error) };
  }

  const metricas: Record<string, MetricasPublicacion> = {};
  async function una(item: { id: string; catalogo: boolean }) {
    const seguro = <T,>(p: Promise<T | null>) => p.catch(() => null);
    const visitas = await seguro(visitasItemMl(item.id, token, DIAS_METRICAS));
    const calidad = await seguro(calidadItemMl(item.id, token));
    const competencia = item.catalogo ? await seguro(competenciaItemMl(item.id, token, cuenta!.siteId)) : null;
    metricas[item.id] = { visitas, calidad, competencia };
  }
  // De a pocas a la vez: con muchas en paralelo se pisa el límite de ML.
  for (let i = 0; i < items.length; i += EN_PARALELO) {
    await Promise.all(items.slice(i, i + EN_PARALELO).map(una));
  }
  return { ok: true, metricas };
}

export type ResultadoEstado = { ok: boolean; aviso: string; estado?: "active" | "paused" };

// Pausar o activar una publicación. Escribe en Mercado Libre: exige
// inventario/modificar y queda en auditoría.
export async function cambiarEstadoPublicacionAction(entrada: { cuentaMlId: string; itemId: string; activar: boolean }): Promise<ResultadoEstado> {
  const ctx = await contexto("modificar");
  if (!ctx) return { ok: false, aviso: "Tu rol no tiene permiso para pausar o activar publicaciones." };
  if (typeof entrada.itemId !== "string" || !PATRON_ID_PRODUCTO_O_ITEM.test(entrada.itemId)) {
    return { ok: false, aviso: "No se reconoce la publicación. Actualiza la página." };
  }
  const cuenta = await cuentaDeLaEmpresa(ctx.empresaId, entrada.cuentaMlId);
  if (!cuenta) return { ok: false, aviso: "Esa cuenta de Mercado Libre ya no está conectada a esta empresa." };
  const activar = entrada.activar === true;

  let respuesta;
  try {
    const token = await obtenerAccessTokenVigente(ctx.empresaId, cuenta.id);
    respuesta = await actualizarItemMl(entrada.itemId, token, { status: activar ? "active" : "paused" });
  } catch (error) {
    if (error instanceof LimiteMercadoLibreError) return { ok: false, aviso: "Mercado Libre pidió esperar un momento. Intenta de nuevo." };
    return { ok: false, aviso: motivoCuentaSinRevisar(error) };
  }
  if (!respuesta.ok) {
    console.warn(`[app/panel/optimizacion] PUT /items respondió ${respuesta.status}`);
    // Mientras Mercado Libre revisa una publicación nueva no deja
    // cambiarle el estado (bug real visto en FullyLemon, 25-sep).
    if (itemNoModificablePorRevision(respuesta.textoCrudo)) {
      return { ok: false, aviso: "Mercado Libre todavía está revisando esta publicación y no deja pausarla ni activarla. Intenta en un rato." };
    }
    if (respuesta.status === 0) {
      return { ok: false, aviso: "Mercado Libre no respondió a tiempo. Revisa en Mercado Libre si el cambio se aplicó antes de reintentar." };
    }
    return { ok: false, aviso: "Mercado Libre no aceptó el cambio. Intenta de nuevo o revísalo en Mercado Libre." };
  }

  await dbComoEmpresa(ctx.empresaId, (tx) =>
    registrarAuditoria(tx, {
      empresaId: ctx.empresaId,
      usuarioId: ctx.usuarioId,
      actorTipo: "persona",
      accion: activar ? "activar_publicacion" : "pausar_publicacion",
      entidad: "publicacion_ml",
      entidadId: entrada.itemId,
      detalle: `${activar ? "Activó" : "Pausó"} la publicación ${entrada.itemId} de ${cuenta.nickname}.`,
    })
  ).catch((error: unknown) => {
    console.error(`[app/panel/optimizacion] Auditoría del cambio de estado falló: ${error instanceof Error ? error.name : "error"}`);
  });
  return { ok: true, aviso: activar ? "Publicación activada." : "Publicación pausada.", estado: activar ? "active" : "paused" };
}
