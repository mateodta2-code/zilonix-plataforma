"use server";

import { redirect, RedirectType } from "next/navigation";
import { cookies } from "next/headers";
import type { seguimientosMl } from "@/db/schema";
import { listarEmpresasDeUsuario } from "@/lib/empresas";
import { obtenerOCrearUsuarioActual } from "@/lib/usuarios";
import { requierePermiso, SinPermisoError } from "@/lib/permisos";
import {
  agregarSeguimiento,
  buscarSeguimientoActivoPorMlId,
  eliminarSeguimiento,
  guardarDatoDePaginaSeguimiento,
  marcarAlertaLeida,
} from "@/lib/seguimiento/seguimientos";
import { datoPaginaSeguimientoValido } from "@/lib/seguimiento/validarDatoPagina";

async function empresaActivaDe(usuarioId: string) {
  const propias = await listarEmpresasDeUsuario(usuarioId);
  const empresaId = cookies().get("empresa_actual")?.value;
  const empresa = propias.find((e) => e.id === empresaId) ?? propias[0];
  if (!empresa) throw new Error("No se encontró tu empresa activa.");
  return empresa;
}

// Issue #204 — bug real en staging: la fila quedaba en guiones hasta
// que corría el cron (cada hora) — se dispara la primera revisión en
// el MISMO request que agrega, para que la fila ya tenga datos reales
// cuando esta acción redirige a la lista. Import DINÁMICO: igual que
// app/api/trabajos/seguimiento/route.ts, lib/trabajos/revisionDiariaSeguimiento.ts
// importa (transitivo) db/trabajador-seguimiento-context.ts, que
// revienta al cargarse sin DATABASE_URL_SEGUIMIENTO — un import
// estático acá arriba haría que page.tsx (que importa este archivo)
// reviente el build de Next.js si esa variable todavía no existe en el
// ambiente. Nunca lanza (ver revisarAhoraUnSeguimiento) — si falla, se
// devuelve el mensaje para avisar, pero el seguimiento ya agregado
// nunca se deshace.
// Refs #175 — un solo reintento (nunca más: esto corre adentro del
// mismo request que agrega el seguimiento, antes del redirect; cada
// intento ya hace su propia llamada a Mercado Libre con reintentos de
// 429 — lib/trabajos/revisionDiariaSeguimiento.ts — así que encadenar
// más acá solo alargaría el request sin agregar nada). Cubre el caso
// real más común de un fallo transitorio (candado de renovación de
// token ocupado por el cron, un 5xx puntual de ML) — un error de
// cuenta/permiso de verdad (sin cuenta conectada, token vencido)
// fallará igual la segunda vez, y ESE mensaje es el que termina en
// pantalla.
async function dispararPrimeraRevision(seguimiento: typeof seguimientosMl.$inferSelect): Promise<string | null> {
  const { revisarAhoraUnSeguimiento } = await import("@/lib/trabajos/revisionDiariaSeguimiento");
  const primerIntento = await revisarAhoraUnSeguimiento(seguimiento);
  if (primerIntento.ok) return null;
  const segundoIntento = await revisarAhoraUnSeguimiento(seguimiento);
  return segundoIntento.ok ? null : segundoIntento.error;
}

// Issue #175 — mismo permiso que "Investigación" para ver (inventario,
// consultar); agregar/quitar un seguimiento o marcar una alerta es una
// escritura, pide "modificar" — mismo criterio que
// app/panel/publicar/clip/actions.ts.
export async function agregarSeguimientoAction(formData: FormData): Promise<void> {
  const usuario = await obtenerOCrearUsuarioActual();
  if (!usuario) redirect("/sign-in");
  const empresa = await empresaActivaDe(usuario.id);
  await requierePermiso(usuario.id, empresa.id, "inventario", "modificar");

  const tipo = String(formData.get("tipo") ?? "");
  const link = String(formData.get("link") ?? "").trim();
  const esCompetidor = formData.get("esCompetidor") === "1";
  if ((tipo !== "producto" && tipo !== "tienda") || !link) {
    throw new Error("Elegí el tipo y pegá un link o id de Mercado Libre.");
  }

  let seguimiento: typeof seguimientosMl.$inferSelect;
  try {
    seguimiento = await agregarSeguimiento(empresa.id, usuario.id, { tipo, link, esCompetidor });
  } catch (error) {
    // Mensaje legible en vez de la pantalla de error genérica de
    // Next.js — los 3 tipos reales que agregarSeguimiento puede
    // lanzar ya traen un mensaje en español claro.
    const mensaje = error instanceof Error ? error.message : "No se pudo agregar el seguimiento.";
    redirect(`/panel/investigacion/seguimiento?error=${encodeURIComponent(mensaje)}`);
  }

  const errorPrimeraRevision = await dispararPrimeraRevision(seguimiento);
  redirect(
    errorPrimeraRevision
      ? `/panel/investigacion/seguimiento?agregado=1&primeraRevisionError=${encodeURIComponent(errorPrimeraRevision)}`
      : "/panel/investigacion/seguimiento?agregado=1"
  );
}

// Issue #182 — la extensión (0.3.0, "Seguir en Zilonix") abre esta
// pantalla con ?agregar=<itemId MCO> o ?agregar_tienda=<sellerId
// numérico>; page.tsx ya validó el FORMATO del id (/^MCO\d+$/ o
// /^\d+$/) antes de llamar acá — esta función hace el resto: mismo
// permiso que agregarSeguimientoAction (inventario, modificar), chequea
// si ya existe un seguimiento activo con ese id (para avisar "ya
// existía" en vez de reinsertar) y, si no, llama a agregarSeguimiento()
// directo con el id ya resuelto (acepta link O id, ver
// lib/seguimiento/link.ts). Siempre termina en un redirect REPLACE a la
// misma ruta sin el query de agregar, para que F5 (o volver atrás) no
// lo vuelva a disparar.
export async function procesarAgregarPorQuery(empresaId: string, usuarioId: string, datos: { tipo: "producto" | "tienda"; mlIdExterno: string }): Promise<void> {
  try {
    await requierePermiso(usuarioId, empresaId, "inventario", "modificar");
  } catch (error) {
    if (!(error instanceof SinPermisoError)) throw error;
    redirect(`/panel/investigacion/seguimiento?error=${encodeURIComponent("No tenés permiso para agregar seguimientos — hace falta el permiso de modificar inventario.")}`, RedirectType.replace);
  }

  const existente = await buscarSeguimientoActivoPorMlId(empresaId, datos.mlIdExterno);
  if (existente) {
    redirect("/panel/investigacion/seguimiento?yaExistia=1", RedirectType.replace);
  }

  let seguimiento: typeof seguimientosMl.$inferSelect;
  try {
    seguimiento = await agregarSeguimiento(empresaId, usuarioId, { tipo: datos.tipo, link: datos.mlIdExterno, esCompetidor: false });
  } catch (error) {
    const mensaje = error instanceof Error ? error.message : "No se pudo agregar el seguimiento.";
    redirect(`/panel/investigacion/seguimiento?error=${encodeURIComponent(mensaje)}`, RedirectType.replace);
  }

  const errorPrimeraRevision = await dispararPrimeraRevision(seguimiento);
  redirect(
    errorPrimeraRevision
      ? `/panel/investigacion/seguimiento?agregado=1&primeraRevisionError=${encodeURIComponent(errorPrimeraRevision)}`
      : "/panel/investigacion/seguimiento?agregado=1",
    RedirectType.replace
  );
}

export async function eliminarSeguimientoAction(formData: FormData): Promise<void> {
  const usuario = await obtenerOCrearUsuarioActual();
  if (!usuario) redirect("/sign-in");
  const empresa = await empresaActivaDe(usuario.id);
  await requierePermiso(usuario.id, empresa.id, "inventario", "modificar");

  const seguimientoId = String(formData.get("seguimientoId") ?? "");
  if (!seguimientoId) throw new Error("Falta el seguimiento a quitar.");

  await eliminarSeguimiento(empresa.id, seguimientoId);
  redirect("/panel/investigacion/seguimiento?eliminado=1");
}

export async function marcarAlertaLeidaAction(formData: FormData): Promise<void> {
  const usuario = await obtenerOCrearUsuarioActual();
  if (!usuario) redirect("/sign-in");
  const empresa = await empresaActivaDe(usuario.id);
  await requierePermiso(usuario.id, empresa.id, "inventario", "modificar");

  const alertaId = String(formData.get("alertaId") ?? "");
  if (!alertaId) throw new Error("Falta la alerta a marcar.");

  await marcarAlertaLeida(empresa.id, alertaId);
  redirect("/panel/investigacion/seguimiento?leida=1");
}

// Issue #251 — a diferencia de las acciones de arriba (todas atadas a
// un <form>, siempre terminan en redirect), esta la llama directo
// código cliente (EscuchaExtension.tsx, el listener del mensaje
// "dato-pagina-seguimiento" que ya reenvía marcador-zilonix.js) — es
// una llamada de fondo, sin navegación: nunca redirige, nunca lanza
// hacia la UI (un error acá no debe romper la pantalla que la persona
// está mirando). `empresaId` SIEMPRE se resuelve del lado del
// servidor (sesión + cookie, igual que el resto de este archivo) —
// nunca se confía en nada que mande el cliente salvo el payload en
// sí, y ESE se vuelve a validar entero acá, nunca se asume que el
// mensaje de la extensión viene bien formado solo porque llegó por
// este canal.
// Issue #252 (revisión de Pablo, punto 3) — datoPaginaSeguimientoValido
// (y los patrones/topes que usa) se movieron a lib/seguimiento/
// validarDatoPagina.ts: este archivo tiene "use server" (Next.js exige
// que un archivo así solo exporte funciones async), así que un type
// guard sync no podía exportarse de acá para probarlo directo con
// vitest.

// Refs #175 — antes las 3 ramas de abajo devolvían `null` en silencio
// (bug reportado: ni un log). Ahora cada una loguea su motivo real del
// lado del servidor (para diagnosticar sin adivinar) y lo devuelve
// tipado, para que guardarDatoPaginaSeguimientoAction/
// guardarVariosDatosPaginaSeguimientoAction puedan pasarle a
// EscuchaExtension.tsx un motivo claro en vez de tragarse el fallo —
// nunca navega ni lanza hacia la UI, sigue siendo una llamada de fondo.
type ResultadoEmpresaExtension =
  | { ok: true; empresa: Awaited<ReturnType<typeof empresaActivaDe>> }
  | { ok: false; motivo: "sin_sesion" | "sin_empresa" | "sin_permiso" };

async function empresaConPermisoDeExtension(): Promise<ResultadoEmpresaExtension> {
  const usuario = await obtenerOCrearUsuarioActual();
  if (!usuario) {
    console.warn("[app/panel/investigacion/seguimiento/actions] guardado de extensión: sin sesión activa.");
    return { ok: false, motivo: "sin_sesion" };
  }
  let empresa;
  try {
    empresa = await empresaActivaDe(usuario.id);
  } catch (error) {
    console.warn(
      "[app/panel/investigacion/seguimiento/actions] guardado de extensión: sin empresa activa:",
      error instanceof Error ? error.message : error
    );
    return { ok: false, motivo: "sin_empresa" };
  }
  try {
    await requierePermiso(usuario.id, empresa.id, "inventario", "modificar");
  } catch (error) {
    if (!(error instanceof SinPermisoError)) throw error;
    console.warn(`[app/panel/investigacion/seguimiento/actions] guardado de extensión: sin permiso (empresa ${empresa.id}).`);
    return { ok: false, motivo: "sin_permiso" };
  }
  return { ok: true, empresa };
}

// Refs #175 — motivo único para que EscuchaExtension.tsx muestre un
// Toast con un mensaje claro en vez de ignorar el fallo (antes estas
// dos acciones devolvían `void`, así que un guardado perdido era
// indistinguible de uno exitoso del lado del cliente).
export type ResultadoGuardadoExtension =
  | { ok: true }
  | {
      ok: false;
      motivo: "payload_invalido" | "sin_sesion" | "sin_empresa" | "sin_permiso" | "seguimiento_inactivo" | "tipo_no_coincide";
    };

export async function guardarDatoPaginaSeguimientoAction(payload: unknown): Promise<ResultadoGuardadoExtension> {
  if (!datoPaginaSeguimientoValido(payload)) return { ok: false, motivo: "payload_invalido" };
  const empresaResultado = await empresaConPermisoDeExtension();
  if (!empresaResultado.ok) return empresaResultado;
  return guardarDatoDePaginaSeguimiento(empresaResultado.empresa.id, payload);
}

// Issue #251 (corrección de Pablo, punto 7) — EscuchaExtension.tsx
// vacía la cola que background.js encoló (visitas a Mercado Libre
// mientras la pestaña de Seguimiento estaba cerrada) en UN SOLO golpe:
// una Server Action para todo el lote, en vez de una llamada —y un
// router.refresh()— por cada lectura encolada. Cada payload se valida
// por separado (uno malformado no tumba a los demás) y se guarda en
// el mismo ORDEN en que llegó (secuencial, nunca en paralelo: son
// lecturas encoladas en orden cronológico — procesarlas en paralelo
// podría hacer que una más vieja pise, por una carrera de escritura,
// el resultado de una más nueva).
// Refs #175 — el resultado acá es a nivel de LOTE, no por payload: un
// item viejo de la cola que ya no tiene seguimiento activo
// ("seguimiento_inactivo") es ruido esperado (se eliminó mientras la
// cola tenía visitas pendientes), no un fallo que valga la pena
// mostrar en pantalla — ese caso puntual solo se loguea (arriba, en
// guardarDatoDePaginaSeguimiento). Lo que SÍ se avisa es que el LOTE
// entero no se pudo ni empezar a guardar (sin sesión/empresa/permiso,
// o ningún payload con formato válido).
export async function guardarVariosDatosPaginaSeguimientoAction(payloads: unknown): Promise<ResultadoGuardadoExtension> {
  if (!Array.isArray(payloads) || payloads.length === 0) return { ok: false, motivo: "payload_invalido" };
  const empresaResultado = await empresaConPermisoDeExtension();
  if (!empresaResultado.ok) return empresaResultado;

  // Corrección de Pablo (sobre 8474c60) — ordena por `leidoEn`
  // ASCENDENTE antes de guardar: el lote de la cola puede llegar
  // desordenado — sin esto, una lectura vieja procesada DESPUÉS de una
  // más nueva (del mismo día) pisaría el dato más fresco con uno más
  // viejo, al revés de "la lectura más reciente manda" (ver
  // guardarDatoDePaginaSeguimiento, lib/seguimiento/seguimientos.ts).
  const validos = payloads.filter(datoPaginaSeguimientoValido);
  if (validos.length === 0) return { ok: false, motivo: "payload_invalido" };
  validos.sort((a, b) => new Date(a.leidoEn).getTime() - new Date(b.leidoEn).getTime());

  for (const payload of validos) {
    await guardarDatoDePaginaSeguimiento(empresaResultado.empresa.id, payload);
  }
  return { ok: true };
}
