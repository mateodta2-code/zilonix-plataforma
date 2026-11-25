"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { and, eq, isNull } from "drizzle-orm";
import { dbComoEmpresa } from "@/db/empresa-context";
import { cuentasMl } from "@/db/schema";
import { registrarAuditoria } from "@/lib/auditoria";
import { listarEmpresasDeUsuario } from "@/lib/empresas";
import { LimiteMercadoLibreError, motivoErrorEscrituraMl } from "@/lib/ml/cliente";
import { obtenerAccessTokenVigente } from "@/lib/ml/cuentas";
import { obtenerMotivosFallaDevolucionMl, revisarDevolucionMl, type ResultadoRevision } from "@/lib/ml/devolucionesRevision";
import { motivoCuentaSinRevisar } from "@/lib/ml/preguntas";
import { PATRON_ID_RECLAMO, type ReclamoBaseMl } from "@/lib/ml/reclamos";
import {
  leerReclamoParaEscribirMl,
  obtenerOfertasReembolsoParcialMl,
  ofrecerDevolucionMl,
  ofrecerReembolsoParcialMl,
  ordenDelReclamo,
  pedirMediacionMl,
  reembolsoTotalMl,
  type AccionDinero,
  type ResultadoEscrituraDinero,
} from "@/lib/ml/reclamosResolucion";
import { creaContador, superaLimite } from "@/lib/limite-peticiones";
import { requierePermiso, SinPermisoError } from "@/lib/permisos";
import { obtenerOCrearUsuarioActual } from "@/lib/usuarios";
import { esUuid } from "@/lib/validacion";

// Reclamos-Dinero (Refs #646). Estas acciones MUEVEN DINERO REAL. Cada
// una: permiso ventas/modificar, cuenta de ESTA empresa, relectura del
// reclamo justo antes de escribir (abierto + acción aún disponible),
// bloqueo de doble envío, límite por empresa y auditoría de cada
// intento (también el rechazado). Nada del comprador se guarda.

export type ResultadoAccionDinero = { ok: boolean; aviso: string };

const ID_NUMERICO = /^\d{1,20}$/;
const LIMITE_POR_MINUTO = 10;
const VENTANA_MS = 60_000;
const ENFRIAMIENTO_MS = 30_000;
const contador = creaContador();
// Doble envío: clave en curso, o resuelta hace menos de ENFRIAMIENTO_MS.
const bloqueos = new Map<string, number>();

function tomarBloqueo(clave: string): boolean {
  const ahora = Date.now();
  const hasta = bloqueos.get(clave);
  if (hasta !== undefined && hasta > ahora) return false;
  // En curso: se libera al terminar; el tope evita un bloqueo eterno si algo se cuelga.
  bloqueos.set(clave, ahora + 60_000);
  return true;
}
function soltarBloqueo(clave: string, enfriar: boolean) {
  if (enfriar) bloqueos.set(clave, Date.now() + ENFRIAMIENTO_MS);
  else bloqueos.delete(clave);
}

type Contexto = { usuarioId: string; empresaId: string; cuentaId: string; cuentaIdExterna: string; nickname: string };

async function resolverContexto(cuentaId: string, reclamoId: string): Promise<Contexto | ResultadoAccionDinero> {
  const usuario = await obtenerOCrearUsuarioActual();
  if (!usuario) redirect("/sign-in");
  const propias = await listarEmpresasDeUsuario(usuario.id);
  const empresaIdCookie = cookies().get("empresa_actual")?.value;
  const empresa = propias.find((e) => e.id === empresaIdCookie) ?? propias[0];
  if (!empresa) redirect("/crear-empresa");

  try {
    await requierePermiso(usuario.id, empresa.id, "ventas", "modificar");
  } catch (error) {
    if (!(error instanceof SinPermisoError)) throw error;
    return { ok: false, aviso: "Tu rol no tiene permiso para resolver reclamos." };
  }
  if (!esUuid(cuentaId) || !PATRON_ID_RECLAMO.test(reclamoId)) return { ok: false, aviso: "No se reconoce el reclamo. Actualiza la página." };
  if (superaLimite(contador, empresa.id, LIMITE_POR_MINUTO, VENTANA_MS)) return { ok: false, aviso: "Demasiados intentos seguidos. Espera un minuto." };

  const [cuenta] = await dbComoEmpresa(empresa.id, (tx) =>
    tx
      .select({ id: cuentasMl.id, nickname: cuentasMl.nickname, externa: cuentasMl.cuentaIdExterna })
      .from(cuentasMl)
      .where(and(eq(cuentasMl.id, cuentaId), eq(cuentasMl.empresaId, empresa.id), isNull(cuentasMl.desconectadaTs)))
  );
  if (!cuenta) return { ok: false, aviso: "Esa cuenta de Mercado Libre ya no está conectada a esta empresa." };
  return { usuarioId: usuario.id, empresaId: empresa.id, cuentaId: cuenta.id, cuentaIdExterna: cuenta.externa, nickname: cuenta.nickname };
}

function esContexto(x: Contexto | ResultadoAccionDinero): x is Contexto {
  return "empresaId" in x;
}

// El reclamo debe ser de ESTA cuenta (respondent) y estar abierto.
async function releerReclamo(ctx: Contexto, reclamoId: string, token: string): Promise<ReclamoBaseMl | null> {
  const reclamo = await leerReclamoParaEscribirMl(reclamoId, token);
  if (!reclamo) return null;
  const vendedor = reclamo.jugadores.find((j) => j.rol === "respondent" && j.userId);
  if (vendedor && vendedor.userId !== ctx.cuentaIdExterna) return null;
  return reclamo;
}

async function auditar(ctx: Contexto, accion: string, reclamoId: string, detalle: string) {
  // La acción ya pasó (o fue rechazada) en ML: si la auditoría falla se
  // deja en el log, sin datos del comprador, y no se le dice a la persona
  // que la acción no ocurrió.
  await dbComoEmpresa(ctx.empresaId, (tx) =>
    registrarAuditoria(tx, { empresaId: ctx.empresaId, usuarioId: ctx.usuarioId, actorTipo: "persona", accion, entidad: "reclamo_ml", entidadId: reclamoId, detalle })
  ).catch((error: unknown) => {
    console.error(`[reclamos/resolucion] Auditoría falló: ${error instanceof Error ? error.name : "error"}`);
  });
}

function textoAccion(accion: AccionDinero): { nombre: string; auditoria: string; exito: string } {
  switch (accion) {
    case "reembolso_parcial":
      return { nombre: "el reembolso parcial", auditoria: "reclamo.reembolso_parcial_ofrecido", exito: "Reembolso parcial ofrecido. El comprador decide si lo acepta." };
    case "reembolso_total":
      return { nombre: "el reembolso total", auditoria: "reclamo.reembolso_total", exito: "Reembolso total enviado a Mercado Libre." };
    case "devolucion":
      return { nombre: "la devolución", auditoria: "reclamo.devolucion_ofrecida", exito: "Devolución ofrecida. El comprador decide si la acepta." };
    case "mediacion":
      return { nombre: "la mediación", auditoria: "reclamo.mediacion_pedida", exito: "Mediación pedida a Mercado Libre." };
  }
}

export type EntradaAccionDinero = { cuentaId: string; reclamoId: string; accion: AccionDinero; porcentaje?: number };

export async function ejecutarAccionDineroAction(entrada: EntradaAccionDinero): Promise<ResultadoAccionDinero> {
  const ctx = await resolverContexto(entrada.cuentaId, entrada.reclamoId);
  if (!esContexto(ctx)) return ctx;
  const t = textoAccion(entrada.accion);
  if (!t) return { ok: false, aviso: "Acción no reconocida." };

  const clave = `${ctx.empresaId}:${ctx.cuentaId}:${entrada.reclamoId}`;
  if (!tomarBloqueo(clave)) return { ok: false, aviso: "Ya hay una acción en curso sobre este reclamo. Espera un momento y actualiza." };

  let enfriar = false;
  try {
    let resultado: ResultadoEscrituraDinero;
    let detalle = "";
    let reclamo: ReclamoBaseMl | null;
    try {
      const token = await obtenerAccessTokenVigente(ctx.empresaId, ctx.cuentaId);
      reclamo = await releerReclamo(ctx, entrada.reclamoId, token);
      if (!reclamo) return { ok: false, aviso: "No se encontró el reclamo en Mercado Libre." };
      const base = ordenDelReclamo(reclamo);
      const venta = base ? ` Venta ${base}.` : "";

      if (entrada.accion === "reembolso_parcial") {
        const ofertas = await obtenerOfertasReembolsoParcialMl(entrada.reclamoId, token);
        const porcentaje = entrada.porcentaje;
        if (!ofertas || typeof porcentaje !== "number") return { ok: false, aviso: "No se pudieron leer las ofertas de Mercado Libre. Intenta de nuevo." };
        const oferta = ofertas.ofertas.find((o) => o.porcentaje === porcentaje);
        detalle = `${porcentaje} %${oferta?.monto != null ? ` (${oferta.monto} ${ofertas.moneda ?? ""})`.trimEnd() : ""}.`;
        resultado = await ofrecerReembolsoParcialMl(reclamo, porcentaje, ofertas, token);
        detalle += venta;
      } else {
        const f = { reembolso_total: reembolsoTotalMl, devolucion: ofrecerDevolucionMl, mediacion: pedirMediacionMl }[entrada.accion];
        resultado = await f(reclamo, token);
        detalle = venta.trim();
      }
    } catch (error) {
      if (error instanceof LimiteMercadoLibreError) return { ok: false, aviso: "Mercado Libre pidió esperar un momento. Intenta de nuevo." };
      return { ok: false, aviso: motivoCuentaSinRevisar(error) };
    }

    const cuenta = `Cuenta ${ctx.nickname}, reclamo ${entrada.reclamoId}.`;
    if (!resultado.llamado) {
      await auditar(ctx, `${t.auditoria}_bloqueado`, entrada.reclamoId, `${cuenta} No se llamó a Mercado Libre: ${resultado.motivo}`);
      return { ok: false, aviso: resultado.motivo ?? "No se pudo hacer la acción." };
    }
    if (!resultado.ok) {
      console.warn(`[reclamos/resolucion] ${entrada.accion} respondió ${resultado.status}`);
      await auditar(ctx, `${t.auditoria}_rechazado`, entrada.reclamoId, `${cuenta} ${detalle} Mercado Libre respondió ${resultado.status}.`);
      if (resultado.status === 401 || resultado.status === 403) return { ok: false, aviso: "Mercado Libre no dejó hacer esto con esta cuenta. Puede que haya que reconectarla." };
      const motivo = motivoErrorEscrituraMl(resultado.textoCrudo);
      return { ok: false, aviso: motivo ? `Mercado Libre no aceptó ${t.nombre}: ${motivo}` : `Mercado Libre no aceptó ${t.nombre}. Abre el reclamo en Mercado Libre.` };
    }
    enfriar = true;
    await auditar(ctx, t.auditoria, entrada.reclamoId, `${cuenta} ${detalle} Mercado Libre respondió ${resultado.status}.`);
    return { ok: true, aviso: t.exito };
  } finally {
    soltarBloqueo(clave, enfriar);
  }
}

// Ofertas para el panel «Elegir monto a reembolsar» (solo lectura).
export async function leerOfertasReembolsoAction(entrada: { cuentaId: string; reclamoId: string }) {
  const ctx = await resolverContexto(entrada.cuentaId, entrada.reclamoId);
  if (!esContexto(ctx)) return { ok: false as const, aviso: ctx.aviso };
  try {
    const token = await obtenerAccessTokenVigente(ctx.empresaId, ctx.cuentaId);
    const reclamo = await releerReclamo(ctx, entrada.reclamoId, token);
    if (!reclamo) return { ok: false as const, aviso: "No se encontró el reclamo en Mercado Libre." };
    const ofertas = await obtenerOfertasReembolsoParcialMl(entrada.reclamoId, token);
    if (!ofertas || ofertas.ofertas.length === 0) return { ok: false as const, aviso: "Mercado Libre no ofrece montos de reembolso para este reclamo." };
    return { ok: true as const, ofertas };
  } catch (error) {
    return { ok: false as const, aviso: error instanceof LimiteMercadoLibreError ? "Mercado Libre pidió esperar un momento." : motivoCuentaSinRevisar(error) };
  }
}

export async function leerMotivosFallaDevolucionAction(entrada: { cuentaId: string; reclamoId: string }) {
  const ctx = await resolverContexto(entrada.cuentaId, entrada.reclamoId);
  if (!esContexto(ctx)) return { ok: false as const, aviso: ctx.aviso };
  try {
    const token = await obtenerAccessTokenVigente(ctx.empresaId, ctx.cuentaId);
    return { ok: true as const, motivos: await obtenerMotivosFallaDevolucionMl(entrada.reclamoId, token) };
  } catch (error) {
    return { ok: false as const, aviso: motivoCuentaSinRevisar(error) };
  }
}

export type EntradaRevisionDevolucion = {
  cuentaId: string;
  reclamoId: string;
  devolucionId: string;
  resultado: ResultadoRevision;
  motivoId?: string;
  mensaje?: string;
};

export async function revisarDevolucionAction(entrada: EntradaRevisionDevolucion): Promise<ResultadoAccionDinero> {
  const ctx = await resolverContexto(entrada.cuentaId, entrada.reclamoId);
  if (!esContexto(ctx)) return ctx;
  if (!ID_NUMERICO.test(entrada.devolucionId) || (entrada.resultado !== "ok" && entrada.resultado !== "con_falla")) return { ok: false, aviso: "No se reconoce la devolución. Actualiza la página." };

  const clave = `${ctx.empresaId}:${ctx.cuentaId}:${entrada.reclamoId}`;
  if (!tomarBloqueo(clave)) return { ok: false, aviso: "Ya hay una acción en curso sobre este reclamo. Espera un momento y actualiza." };
  let enfriar = false;
  try {
    const accion = entrada.resultado === "ok" ? "devolucion.revisada_ok" : "devolucion.revisada_con_falla";
    let r;
    try {
      const token = await obtenerAccessTokenVigente(ctx.empresaId, ctx.cuentaId);
      const reclamo = await releerReclamo(ctx, entrada.reclamoId, token);
      if (!reclamo) return { ok: false, aviso: "No se encontró el reclamo en Mercado Libre." };
      const motivos = entrada.resultado === "con_falla" ? await obtenerMotivosFallaDevolucionMl(entrada.reclamoId, token) : [];
      r = await revisarDevolucionMl(reclamo, { resultado: entrada.resultado, devolucionId: entrada.devolucionId, ordenId: ordenDelReclamo(reclamo), motivoId: entrada.motivoId, mensaje: entrada.mensaje }, motivos, token);
    } catch (error) {
      if (error instanceof LimiteMercadoLibreError) return { ok: false, aviso: "Mercado Libre pidió esperar un momento. Intenta de nuevo." };
      return { ok: false, aviso: motivoCuentaSinRevisar(error) };
    }
    // El texto libre de la revisión es del vendedor, pero no se copia a la auditoría.
    const base = `Cuenta ${ctx.nickname}, reclamo ${entrada.reclamoId}, devolución ${entrada.devolucionId}.`;
    if (!r.llamado) {
      await auditar(ctx, `${accion}_bloqueado`, entrada.reclamoId, `${base} No se llamó a Mercado Libre: ${r.motivo}`);
      return { ok: false, aviso: r.motivo ?? "No se pudo hacer la revisión." };
    }
    if (!r.ok) {
      await auditar(ctx, `${accion}_rechazado`, entrada.reclamoId, `${base} Mercado Libre respondió ${r.status}.`);
      const motivo = motivoErrorEscrituraMl(r.textoCrudo);
      return { ok: false, aviso: motivo ? `Mercado Libre no aceptó la revisión: ${motivo}` : "Mercado Libre no aceptó la revisión. Abre el reclamo en Mercado Libre." };
    }
    enfriar = true;
    await auditar(ctx, accion, entrada.reclamoId, `${base} Mercado Libre respondió ${r.status}.`);
    return { ok: true, aviso: "Revisión enviada a Mercado Libre." };
  } finally {
    soltarBloqueo(clave, enfriar);
  }
}
