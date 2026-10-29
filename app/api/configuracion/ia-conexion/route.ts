import { NextResponse } from "next/server";
import { requierePermiso } from "@/lib/permisos";
import { eliminarConexionIA, guardarConexionIA, obtenerConexionIA } from "@/lib/ia/conexion";
import { exigirUrlBaseIASegura, UrlBaseIAInvalidaError } from "@/lib/ia/validarUrlBase";
import { urlPublicaBase } from "@/lib/url-publica";
import { respuestaSiOrigenInvalido, respuestaSiSinPermiso, resolverSesionYEmpresa } from "../_ayudantes";

// Rama feat-promociones, punto 6 — "En Configuración, una sección
// 'Conexión de IA' por empresa". Vive bajo el módulo "configuracion"
// que YA existe (consultar/modificar) — nunca un permiso nuevo solo
// para esto, y nunca devuelve la API key (obtenerConexionIA, a
// propósito, nunca obtenerConexionIAConClave — ver lib/ia/conexion.ts).
const PROVEEDORES = ["anthropic", "openai", "google", "xai", "otro_compatible_openai"] as const;

export async function GET() {
  const sesion = await resolverSesionYEmpresa();
  if (sesion instanceof NextResponse) return sesion;
  const { usuario, empresa } = sesion;

  try {
    await requierePermiso(usuario.id, empresa.id, "configuracion", "consultar");
  } catch (error) {
    const respuestaPermiso = respuestaSiSinPermiso(error);
    if (respuestaPermiso) return respuestaPermiso;
    throw error;
  }

  const conexion = await obtenerConexionIA(empresa.id);
  return NextResponse.json({ conexion });
}

export async function PUT(request: Request) {
  const base = urlPublicaBase();
  const respuestaOrigen = respuestaSiOrigenInvalido(request, new URL(base).origin);
  if (respuestaOrigen) return respuestaOrigen;

  const sesion = await resolverSesionYEmpresa();
  if (sesion instanceof NextResponse) return sesion;
  const { usuario, empresa } = sesion;

  try {
    await requierePermiso(usuario.id, empresa.id, "configuracion", "modificar");
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
  const c = cuerpo as Record<string, unknown>;
  const proveedor = typeof c?.proveedor === "string" && (PROVEEDORES as readonly string[]).includes(c.proveedor) ? c.proveedor : null;
  const modelo = typeof c?.modelo === "string" ? c.modelo.trim() : "";
  const apiKey = typeof c?.apiKey === "string" ? c.apiKey.trim() : "";
  const baseUrl = typeof c?.baseUrl === "string" && c.baseUrl.trim() ? c.baseUrl.trim() : null;

  if (!proveedor || !modelo || !apiKey) return NextResponse.json({ error: "Faltan datos." }, { status: 400 });
  if (proveedor === "otro_compatible_openai") {
    if (!baseUrl) return NextResponse.json({ error: "Falta la URL base para un proveedor compatible con OpenAI." }, { status: 400 });
    // Code review de Pablo — HIGH 3: una URL base arbitraria es
    // exactamente lo que habilita un SSRF (contra la red interna de
    // Railway, o contra la IP de metadata de la nube) — ver
    // lib/ia/validarUrlBase.ts (misma función que revalida otra vez
    // justo antes de cada llamada real en lib/ia/proveedores.ts).
    try {
      await exigirUrlBaseIASegura(baseUrl);
    } catch (error) {
      if (error instanceof UrlBaseIAInvalidaError) return NextResponse.json({ error: error.message }, { status: 400 });
      throw error;
    }
  }

  await guardarConexionIA(empresa.id, usuario.id, { proveedor: proveedor as (typeof PROVEEDORES)[number], baseUrl, modelo, apiKey });
  return NextResponse.json({ ok: true });
}

export async function DELETE(request: Request) {
  const base = urlPublicaBase();
  const respuestaOrigen = respuestaSiOrigenInvalido(request, new URL(base).origin);
  if (respuestaOrigen) return respuestaOrigen;

  const sesion = await resolverSesionYEmpresa();
  if (sesion instanceof NextResponse) return sesion;
  const { usuario, empresa } = sesion;

  try {
    await requierePermiso(usuario.id, empresa.id, "configuracion", "modificar");
  } catch (error) {
    const respuestaPermiso = respuestaSiSinPermiso(error);
    if (respuestaPermiso) return respuestaPermiso;
    throw error;
  }

  await eliminarConexionIA(empresa.id);
  return NextResponse.json({ ok: true });
}
