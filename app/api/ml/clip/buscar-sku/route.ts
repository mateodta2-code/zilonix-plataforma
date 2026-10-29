import { NextResponse } from "next/server";
import { requierePermiso } from "@/lib/permisos";
import { listarCuentasConectadas } from "@/lib/ml/cuentas";
import { buscarSkuEnTodasLasCuentas } from "@/lib/ml/clip";
import { urlPublicaBase } from "@/lib/url-publica";
import { respuestaSiClipDeshabilitado, respuestaSiOrigenInvalido, respuestaSiSinPermiso, resolverSesionYEmpresa } from "../_ayudantes";

// Rama feat-publicar-clip, punto 3 — "campo SKU + botón 'Buscar en mis
// cuentas'; busca en TODAS las cuentas ML conectadas de la empresa, en
// paralelo, usando buscarItemsPorSkuMl". Esta ruta es solo el
// envoltorio HTTP de lib/ml/clip.ts:buscarSkuEnTodasLasCuentas (ya
// hecha y probada con sus propios tests) — nunca se excluyen acá las
// cuentas desconectadas antes de pasarlas: buscarSkuEnTodasLasCuentas
// recibe TODAS las conectadas de verdad (listarCuentasConectadas ya
// filtra RLS por empresa) y cada fila vuelve con su propio
// motivoNoDisponible si no aplica.
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
    return NextResponse.json({ error: "Falta el SKU." }, { status: 400 });
  }
  const sku = typeof (cuerpo as { sku?: unknown })?.sku === "string" ? (cuerpo as { sku: string }).sku.trim() : "";
  if (!sku) return NextResponse.json({ error: "Falta el SKU." }, { status: 400 });

  const cuentasConectadas = await listarCuentasConectadas(empresa.id);
  const cuentasActivas = cuentasConectadas.filter((c) => !c.desconectadaTs);
  const filas = await buscarSkuEnTodasLasCuentas(empresa.id, cuentasActivas, sku);
  return NextResponse.json({ filas });
}
