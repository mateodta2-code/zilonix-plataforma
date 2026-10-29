import { NextResponse } from "next/server";
import { requierePermiso } from "@/lib/permisos";
import { PATRON_ID_PRODUCTO_O_ITEM } from "@/lib/ml/cliente";
import { obtenerAccessTokenVigente, listarCuentasConectadas } from "@/lib/ml/cuentas";
import { obtenerClipsMl, type ClipMl } from "@/lib/ml/cliente";
import { conConcurrenciaLimitada } from "@/lib/concurrencia";
import { urlPublicaBase } from "@/lib/url-publica";
import { PATRON_UUID, respuestaSiClipDeshabilitado, respuestaSiOrigenInvalido, respuestaSiSinPermiso, resolverSesionYEmpresa } from "../_ayudantes";

// Rama feat-publicar-clip, punto 5 — "Botón 'Actualizar estado' que
// consulte cada item subido en esta sesión" (vía GET /marketplace/
// items/{id}/clips, lib/ml/cliente.ts:obtenerClipsMl — documentado ahí
// como el único endpoint de este módulo nunca confirmado contra una
// cuenta real con un clip de verdad ya moderado). Sin tabla nueva
// (punto 5 del pedido): la lista de qué consultar la manda el propio
// navegador (lo que subió ESTA sesión, en memoria del lado del
// cliente), nunca se guarda del lado del servidor.
const CONCURRENCIA_CONSULTA_ESTADO = 5;

type ItemPedido = { cuentaId: string; itemId: string };
export type FilaEstadoClip = { cuentaId: string; itemId: string; clips: ClipMl[] | null };

function parsearItemsPedidos(cuerpo: unknown): ItemPedido[] | null {
  const items = (cuerpo as { items?: unknown })?.items;
  if (!Array.isArray(items) || items.length === 0) return null;
  const resultado: ItemPedido[] = [];
  for (const fila of items) {
    const cuentaId = (fila as { cuentaId?: unknown })?.cuentaId;
    const itemId = (fila as { itemId?: unknown })?.itemId;
    if (typeof cuentaId !== "string" || typeof itemId !== "string") return null;
    if (!PATRON_UUID.test(cuentaId) || !PATRON_ID_PRODUCTO_O_ITEM.test(itemId)) return null;
    resultado.push({ cuentaId, itemId });
  }
  return resultado;
}

export async function POST(request: Request) {
  const respuestaDeshabilitado = respuestaSiClipDeshabilitado();
  if (respuestaDeshabilitado) return respuestaDeshabilitado;

  const base = urlPublicaBase();
  const respuestaOrigen = respuestaSiOrigenInvalido(request, new URL(base).origin);
  if (respuestaOrigen) return respuestaOrigen;

  const sesion = await resolverSesionYEmpresa();
  if (sesion instanceof NextResponse) return sesion;
  const { usuario, empresa } = sesion;

  try {
    await requierePermiso(usuario.id, empresa.id, "inventario", "consultar");
  } catch (error) {
    const respuestaPermiso = respuestaSiSinPermiso(error);
    if (respuestaPermiso) return respuestaPermiso;
    throw error;
  }

  let cuerpo: unknown;
  try {
    cuerpo = await request.json();
  } catch {
    return NextResponse.json({ error: "Faltan datos." }, { status: 400 });
  }
  const itemsPedidos = parsearItemsPedidos(cuerpo);
  if (!itemsPedidos) return NextResponse.json({ error: "Faltan datos." }, { status: 400 });

  // listarCuentasConectadas pasa por RLS — una cuentaId de otra
  // empresa (o ya desconectada) nunca llega a pedir un token real,
  // queda con clips:null (mismo criterio que "no se pudo consultar").
  const cuentasConectadas = await listarCuentasConectadas(empresa.id);

  const filas: FilaEstadoClip[] = await conConcurrenciaLimitada(itemsPedidos, CONCURRENCIA_CONSULTA_ESTADO, async (pedido) => {
    const cuenta = cuentasConectadas.find((c) => c.id === pedido.cuentaId && !c.desconectadaTs);
    if (!cuenta) return { cuentaId: pedido.cuentaId, itemId: pedido.itemId, clips: null };
    try {
      const token = await obtenerAccessTokenVigente(empresa.id, pedido.cuentaId);
      const clips = await obtenerClipsMl(pedido.itemId, token);
      return { cuentaId: pedido.cuentaId, itemId: pedido.itemId, clips };
    } catch {
      return { cuentaId: pedido.cuentaId, itemId: pedido.itemId, clips: null };
    }
  });

  return NextResponse.json({ filas });
}
