import { NextResponse } from "next/server";
import { requierePermiso } from "@/lib/permisos";
import { elegirRecomendado, ERRORES_MODELOS_IA, listarModelosDeConexion, listarModelosProveedor, type ResultadoModelos } from "@/lib/ia/modelos";
import type { ProveedorIA } from "@/lib/ia/tipos";
import { creaContador, superaLimite } from "@/lib/limite-peticiones";
import { respuestaSiSinPermiso } from "../../_ayudantes";
import { idValido, PROVEEDORES_IA, respuestaNoEncontrada, sesionIA } from "../../_ia";

// Límite por empresa: 10 consultas por minuto (memoria del proceso).
const consultas = creaContador();

// Devuelve solo la lista de modelos y el recomendado: nunca la clave ni
// datos crudos del proveedor.
export async function POST(request: Request) {
  const sesion = await sesionIA(request);
  if (sesion instanceof NextResponse) return sesion;
  try {
    await requierePermiso(sesion.usuario.id, sesion.empresa.id, "configuracion", "modificar");
  } catch (error) {
    const sinPermiso = respuestaSiSinPermiso(error);
    if (sinPermiso) return sinPermiso;
    throw error;
  }
  let cuerpo: Record<string, unknown>;
  try {
    cuerpo = ((await request.json()) ?? {}) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ ok: false, error: "Faltan datos." }, { status: 400 });
  }
  const proveedorPedido = typeof cuerpo.proveedor === "string" && (PROVEEDORES_IA as readonly string[]).includes(cuerpo.proveedor) ? (cuerpo.proveedor as ProveedorIA) : null;
  if (!proveedorPedido) return NextResponse.json({ ok: false, error: "Faltan datos." }, { status: 400 });
  const apiKey = typeof cuerpo.apiKey === "string" ? cuerpo.apiKey.trim() : "";
  const conexionId = typeof cuerpo.conexionId === "string" && idValido(cuerpo.conexionId) ? cuerpo.conexionId : null;
  if (!apiKey && !conexionId) return NextResponse.json({ ok: false, error: "Falta la API key." }, { status: 400 });

  if (superaLimite(consultas, sesion.empresa.id, 10, 60_000)) {
    return NextResponse.json({ ok: false, error: "Hiciste muchas consultas seguidas. Espera un minuto." }, { status: 429 });
  }
  let proveedor = proveedorPedido;
  let r: ResultadoModelos;
  if (apiKey) {
    r = await listarModelosProveedor(proveedor, apiKey);
  } else {
    // La clave guardada se lee dentro de lib/ia: aquí solo llega el resultado.
    const guardada = await listarModelosDeConexion(sesion.empresa.id, conexionId as string);
    if (!guardada) return respuestaNoEncontrada();
    proveedor = guardada.proveedor; // manda el proveedor guardado
    r = guardada.resultado;
  }
  if (!r.ok) return NextResponse.json({ ok: false, error: ERRORES_MODELOS_IA[r.error] });
  return NextResponse.json({ ok: true, modelos: r.modelos, recomendado: elegirRecomendado(proveedor, r.modelos) });
}
