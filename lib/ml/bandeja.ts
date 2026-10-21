import { asc, desc, eq } from "drizzle-orm";
import { dbComoEmpresa } from "@/db/empresa-context";
import { mensajesMl, mensajesMlHilo, membresias, usuarios, cuentasMl } from "@/db/schema";
import { obtenerAccessTokenVigente } from "@/lib/ml/cuentas";
import { registrarAuditoria } from "@/lib/auditoria";

// Tarea 2.9 — formato de petición confirmado contra el código real ya
// en producción del Zilonix OS actual (lib/mercadolibre-mensajes.js) —
// no inventado, incluido el bug real del tópico "messages" (el aviso
// trae el message_id crudo, nunca un path con el pack_id).

const PLAZO_RESPUESTA_HORAS = 24; // punto de partida simple y honesto — no es un SLA oficial de Mercado Libre, es un primer umbral razonable

async function traerInfoItem(accessToken: string, itemId: string | null) {
  if (!itemId) return { titulo: null, permalink: null };
  const res = await fetch(`https://api.mercadolibre.com/items/${itemId}?attributes=id,title,permalink`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) return { titulo: null, permalink: null }; // un ítem borrado no debe tumbar el guardado de la pregunta/reclamo/mensaje
  const d = await res.json();
  return { titulo: d.title ?? null, permalink: d.permalink ?? null };
}

async function traerNicknameComprador(accessToken: string, userId: string | number | null | undefined) {
  if (!userId) return null;
  const res = await fetch(`https://api.mercadolibre.com/users/${userId}?attributes=id,nickname`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) return null;
  const d = await res.json();
  return d.nickname ?? null;
}

function plazoDesde(fecha: Date): Date {
  return new Date(fecha.getTime() + PLAZO_RESPUESTA_HORAS * 60 * 60 * 1000);
}

// ---------- Preguntas ----------

export async function guardarPregunta(empresaId: string, cuentaId: string, questionId: string): Promise<void> {
  const accessToken = await obtenerAccessTokenVigente(empresaId, cuentaId);
  const res = await fetch(`https://api.mercadolibre.com/questions/${questionId}`, { headers: { Authorization: `Bearer ${accessToken}` } });
  if (!res.ok) throw new Error(`Mercado Libre respondió ${res.status} al traer la pregunta ${questionId}.`);
  const q = await res.json();

  const [info, nickname] = await Promise.all([
    traerInfoItem(accessToken, q.item_id ?? null),
    traerNicknameComprador(accessToken, q.from?.id),
  ]);
  const respondida = q.status === "ANSWERED";
  const ocurridoTs = q.date_created ? new Date(q.date_created) : new Date();

  await dbComoEmpresa(empresaId, (tx) =>
    tx
      .insert(mensajesMl)
      .values({
        empresaId,
        cuentaMlId: cuentaId,
        tipo: "pregunta",
        externalId: String(q.id),
        itemId: q.item_id ?? null,
        itemTitulo: info.titulo,
        itemPermalink: info.permalink,
        compradorId: q.from?.id ? String(q.from.id) : null,
        compradorNickname: nickname,
        texto: q.text ?? null,
        estado: q.status ?? null,
        respondida,
        vencePorResponderTs: respondida ? null : plazoDesde(ocurridoTs),
        detalle: q,
        ocurridoTs,
      })
      .onConflictDoUpdate({
        target: [mensajesMl.empresaId, mensajesMl.tipo, mensajesMl.externalId],
        set: { estado: q.status ?? null, respondida, texto: q.text ?? null, detalle: q, itemTitulo: info.titulo, compradorNickname: nickname },
      })
  );
}

// API real confirmada: POST /answers {question_id, text}.
export async function responderPregunta(empresaId: string, cuentaId: string, questionExternalId: string, texto: string): Promise<void> {
  const accessToken = await obtenerAccessTokenVigente(empresaId, cuentaId);
  const res = await fetch("https://api.mercadolibre.com/answers", {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}`, "content-type": "application/json" },
    body: JSON.stringify({ question_id: Number(questionExternalId), text: texto }),
  });
  if (!res.ok) {
    const cuerpo = await res.text().catch(() => "");
    throw new Error(`Mercado Libre rechazó la respuesta (HTTP ${res.status}): ${cuerpo.slice(0, 400)}`);
  }
  await guardarPregunta(empresaId, cuentaId, questionExternalId); // trae el estado real ya actualizado, en vez de asumirlo
}

// ---------- Mensajes de venta (hilo real) ----------

// Bug real encontrado en vivo en el sistema actual: el aviso del
// tópico "messages" trae el message_id crudo en "resource", nunca un
// path con el pack_id — hay que resolverlo primero.
export async function resolverPackIdDeMensaje(accessToken: string, messageId: string): Promise<string> {
  const res = await fetch(`https://api.mercadolibre.com/messages/${messageId}`, {
    headers: { Authorization: `Bearer ${accessToken}`, "x-pack-format": "true" },
  });
  if (!res.ok) throw new Error(`Mercado Libre respondió ${res.status} al traer el mensaje ${messageId}.`);
  const data = await res.json();
  if (data.pack_id) return String(data.pack_id);
  if (data.resource === "order" && data.resource_id) {
    const ordenRes = await fetch(`https://api.mercadolibre.com/orders/${data.resource_id}`, { headers: { Authorization: `Bearer ${accessToken}` } });
    if (ordenRes.ok) {
      const orden = await ordenRes.json();
      return String(orden.pack_id || data.resource_id);
    }
    return String(data.resource_id);
  }
  throw new Error(`No se pudo determinar a qué venta pertenece el mensaje ${messageId}.`);
}

export async function guardarMensajeVenta(empresaId: string, cuentaId: string, cuentaIdExterna: string, packId: string): Promise<void> {
  const accessToken = await obtenerAccessTokenVigente(empresaId, cuentaId);
  const res = await fetch(`https://api.mercadolibre.com/messages/packs/${packId}/sellers/${cuentaIdExterna}?tag=post_sale`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) throw new Error(`Mercado Libre respondió ${res.status} al traer los mensajes del pack ${packId}.`);
  const data = await res.json();
  const lista: { id: string; text: string; from?: { user_id: string | number }; message_date?: { received?: string; created?: string } }[] =
    data.messages ?? [];
  const ultimo = lista[lista.length - 1] ?? null;
  const compradorId = lista.find((m) => String(m.from?.user_id) !== String(cuentaIdExterna))?.from?.user_id ?? null;
  const itemId = data?.conversation?.item_id ?? null;
  const [info, nickname] = await Promise.all([traerInfoItem(accessToken, itemId), traerNicknameComprador(accessToken, compradorId)]);
  // "respondida" = el último mensaje del hilo lo mandamos nosotros.
  const respondida = !!(ultimo && String(ultimo.from?.user_id) === String(cuentaIdExterna));
  const ocurridoTs = ultimo?.message_date?.received
    ? new Date(ultimo.message_date.received)
    : ultimo?.message_date?.created
      ? new Date(ultimo.message_date.created)
      : new Date();

  await dbComoEmpresa(empresaId, async (tx) => {
    const [fila] = await tx
      .insert(mensajesMl)
      .values({
        empresaId,
        cuentaMlId: cuentaId,
        tipo: "mensaje",
        externalId: String(packId),
        itemId,
        itemTitulo: info.titulo,
        itemPermalink: info.permalink,
        compradorId: compradorId ? String(compradorId) : null,
        compradorNickname: nickname,
        estado: "recibido",
        respondida,
        vencePorResponderTs: respondida ? null : plazoDesde(ocurridoTs),
        detalle: data,
        ocurridoTs,
      })
      .onConflictDoUpdate({
        target: [mensajesMl.empresaId, mensajesMl.tipo, mensajesMl.externalId],
        set: {
          estado: "recibido",
          respondida,
          vencePorResponderTs: respondida ? null : plazoDesde(ocurridoTs),
          detalle: data,
          ocurridoTs,
          itemTitulo: info.titulo,
          compradorNickname: nickname,
        },
      })
      .returning({ id: mensajesMl.id });

    for (const m of lista) {
      await tx
        .insert(mensajesMlHilo)
        .values({
          empresaId,
          mensajeMlId: fila.id,
          externalId: String(m.id),
          deComprador: String(m.from?.user_id) !== String(cuentaIdExterna),
          texto: m.text ?? null,
          ts: m.message_date?.received ? new Date(m.message_date.received) : m.message_date?.created ? new Date(m.message_date.created) : new Date(),
        })
        .onConflictDoNothing({ target: [mensajesMlHilo.mensajeMlId, mensajesMlHilo.externalId] });
    }
  });
}

async function resolverCuentaIdExterna(empresaId: string, cuentaId: string): Promise<string> {
  const [cuenta] = await dbComoEmpresa(empresaId, (tx) => tx.select({ cuentaIdExterna: cuentasMl.cuentaIdExterna }).from(cuentasMl).where(eq(cuentasMl.id, cuentaId)));
  if (!cuenta) throw new Error("Cuenta de Mercado Libre no encontrada.");
  return cuenta.cuentaIdExterna;
}

// API real: POST /messages/packs/{pack_id}/sellers/{seller_id}?tag=post_sale {from, to, text}.
export async function responderMensajeVenta(empresaId: string, cuentaId: string, packId: string, compradorId: string, texto: string): Promise<void> {
  const cuentaIdExterna = await resolverCuentaIdExterna(empresaId, cuentaId);
  const accessToken = await obtenerAccessTokenVigente(empresaId, cuentaId);
  const res = await fetch(`https://api.mercadolibre.com/messages/packs/${packId}/sellers/${cuentaIdExterna}?tag=post_sale`, {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}`, "content-type": "application/json" },
    body: JSON.stringify({ from: { user_id: cuentaIdExterna }, to: { user_id: compradorId }, text: texto }),
  });
  if (!res.ok) {
    const cuerpo = await res.text().catch(() => "");
    throw new Error(`Mercado Libre rechazó la respuesta (HTTP ${res.status}): ${cuerpo.slice(0, 400)}`);
  }
  await guardarMensajeVenta(empresaId, cuentaId, cuentaIdExterna, packId);
}


// ---------- Reclamos ----------

export async function guardarReclamo(empresaId: string, cuentaId: string, claimId: string): Promise<void> {
  const accessToken = await obtenerAccessTokenVigente(empresaId, cuentaId);
  const res = await fetch(`https://api.mercadolibre.com/post-purchase/v1/claims/${claimId}`, { headers: { Authorization: `Bearer ${accessToken}` } });
  if (!res.ok) throw new Error(`Mercado Libre respondió ${res.status} al traer el reclamo ${claimId}.`);
  const c = await res.json();
  // Los reclamos traen campos poco estandarizados según el tipo — se
  // guarda el crudo completo en "detalle" y la pantalla nunca asume un
  // campo puntual que pueda faltar (mismo criterio del sistema actual).
  const estado = c.status ?? c.stage ?? null;
  const resuelto = ["closed", "resolved"].includes(String(estado ?? "").toLowerCase());
  const ocurridoTs = c.date_created ? new Date(c.date_created) : new Date();

  await dbComoEmpresa(empresaId, (tx) =>
    tx
      .insert(mensajesMl)
      .values({
        empresaId,
        cuentaMlId: cuentaId,
        tipo: "reclamo",
        externalId: String(claimId),
        estado,
        respondida: resuelto,
        vencePorResponderTs: resuelto ? null : plazoDesde(ocurridoTs),
        detalle: c,
        ocurridoTs,
      })
      .onConflictDoUpdate({
        target: [mensajesMl.empresaId, mensajesMl.tipo, mensajesMl.externalId],
        set: { estado, respondida: resuelto, detalle: c },
      })
  );
}

// API real: POST /marketplace/v2/claims/{claim_id}/actions/send-message.
export async function responderReclamo(empresaId: string, cuentaId: string, claimId: string, texto: string): Promise<void> {
  const accessToken = await obtenerAccessTokenVigente(empresaId, cuentaId);
  const res = await fetch(`https://api.mercadolibre.com/marketplace/v2/claims/${claimId}/actions/send-message`, {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}`, "content-type": "application/json" },
    body: JSON.stringify({ message: texto }),
  });
  if (!res.ok) {
    const cuerpo = await res.text().catch(() => "");
    throw new Error(`Mercado Libre rechazó la respuesta (HTTP ${res.status}): ${cuerpo.slice(0, 400)}`);
  }
  await guardarReclamo(empresaId, cuentaId, claimId);
}

// ---------- Asignar a operador (funcionalidad nueva, tarea 2.9) ----------

export async function asignarOperador(empresaId: string, usuarioQueAsigna: string, mensajeMlId: string, operadorId: string | null): Promise<void> {
  await dbComoEmpresa(empresaId, async (tx) => {
    await tx.update(mensajesMl).set({ asignadoA: operadorId }).where(eq(mensajesMl.id, mensajeMlId));
    await registrarAuditoria(tx, {
      empresaId,
      usuarioId: usuarioQueAsigna,
      actorTipo: "persona",
      accion: operadorId ? "asignar_bandeja" : "desasignar_bandeja",
      entidad: "mensaje_ml",
      detalle: operadorId ? "Asignó un ítem de la bandeja a un operador." : "Quitó la asignación de un ítem de la bandeja.",
    });
  });
}

// ---------- Lectura para la pantalla ----------

// Tarea 2.9 — "alertas por tiempo": lo vencido y sin responder primero.
export async function listarBandeja(empresaId: string) {
  return dbComoEmpresa(empresaId, (tx) =>
    tx
      .select()
      .from(mensajesMl)
      .where(eq(mensajesMl.empresaId, empresaId))
      .orderBy(asc(mensajesMl.respondida), asc(mensajesMl.vencePorResponderTs), desc(mensajesMl.recibidoTs))
  );
}

export async function obtenerItemConHilo(empresaId: string, mensajeMlId: string) {
  return dbComoEmpresa(empresaId, async (tx) => {
    const [item] = await tx.select().from(mensajesMl).where(eq(mensajesMl.id, mensajeMlId));
    if (!item) return null;
    const hilo =
      item.tipo === "mensaje"
        ? await tx.select().from(mensajesMlHilo).where(eq(mensajesMlHilo.mensajeMlId, mensajeMlId)).orderBy(asc(mensajesMlHilo.ts))
        : [];
    return { item, hilo };
  });
}

// Para el selector de "asignar a" — cualquier persona con membresía en
// la empresa activa es candidata, sin filtrar por rol (quien tenga
// permiso de ver esta pantalla decide a quién asignarle cada ítem).
export async function listarMiembrosParaAsignar(empresaId: string) {
  return dbComoEmpresa(empresaId, (tx) =>
    tx
      .select({ id: usuarios.id, nombre: usuarios.nombre })
      .from(membresias)
      .innerJoin(usuarios, eq(membresias.usuarioId, usuarios.id))
      .where(eq(membresias.empresaId, empresaId))
  );
}
