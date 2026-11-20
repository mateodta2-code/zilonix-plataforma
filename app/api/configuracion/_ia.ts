import { NextResponse } from "next/server";
import { ConexionIANoEncontradaError, LimiteConexionesIAError, PrincipalNoEliminableError } from "@/lib/ia/conexion";
import type { ProveedorIA } from "@/lib/ia/tipos";
import { exigirUrlBaseIASegura, UrlBaseIAInvalidaError } from "@/lib/ia/validarUrlBase";
import { urlPublicaBase } from "@/lib/url-publica";
import { respuestaSiOrigenInvalido, resolverSesionYEmpresa, type SesionYEmpresa } from "./_ayudantes";

// Ayudantes de las rutas de «Conectar IA» (nombre con "_": no se
// clasifica en verificar-permisos). Nunca devuelven la API key.
export const PROVEEDORES_IA = ["anthropic", "openai", "google", "xai", "otro_compatible_openai"] as const;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Origen (si hay cuerpo) + sesión + empresa. El permiso lo pide CADA
// ruta con su propio requierePermiso() (lo exige verificar-permisos).
export async function sesionIA(request: Request | null): Promise<SesionYEmpresa | NextResponse> {
  if (request) {
    const respuestaOrigen = respuestaSiOrigenInvalido(request, new URL(urlPublicaBase()).origin);
    if (respuestaOrigen) return respuestaOrigen;
  }
  return resolverSesionYEmpresa();
}

export function idValido(id: string): boolean {
  return UUID_RE.test(id);
}

export const respuestaNoEncontrada = () => NextResponse.json({ error: "No se encontró esa conexión." }, { status: 404 });

// Errores de dominio → respuesta; null si es otro error.
export function respuestaSiErrorDominio(error: unknown): NextResponse | null {
  if (error instanceof LimiteConexionesIAError || error instanceof PrincipalNoEliminableError) {
    return NextResponse.json({ error: error.message }, { status: 409 });
  }
  if (error instanceof ConexionIANoEncontradaError) return respuestaNoEncontrada();
  return null;
}

export type DatosValidados = { nombre: string; proveedor: ProveedorIA; modelo: string; baseUrl: string | null; apiKey: string };

// Valida el cuerpo de crear/editar. Al crear la key es obligatoria; al
// editar, vacía = no cambiarla.
export async function leerDatosConexion(request: Request, opciones: { exigirKey: boolean }): Promise<DatosValidados | NextResponse> {
  let cuerpo: unknown;
  try {
    cuerpo = await request.json();
  } catch {
    return NextResponse.json({ error: "Faltan datos." }, { status: 400 });
  }
  const c = (cuerpo ?? {}) as Record<string, unknown>;
  const proveedor = typeof c.proveedor === "string" && (PROVEEDORES_IA as readonly string[]).includes(c.proveedor) ? (c.proveedor as ProveedorIA) : null;
  const modelo = typeof c.modelo === "string" ? c.modelo.trim() : "";
  const nombre = typeof c.nombre === "string" ? c.nombre.trim() : "";
  const apiKey = typeof c.apiKey === "string" ? c.apiKey.trim() : "";
  const baseUrl = typeof c.baseUrl === "string" && c.baseUrl.trim() ? c.baseUrl.trim() : null;

  if (!proveedor || !modelo || !nombre || (opciones.exigirKey && !apiKey)) return NextResponse.json({ error: "Faltan datos." }, { status: 400 });
  if (nombre.length > 60) return NextResponse.json({ error: "El nombre puede tener hasta 60 letras." }, { status: 400 });
  if (proveedor === "otro_compatible_openai") {
    if (!baseUrl) return NextResponse.json({ error: "Falta la URL base para un proveedor compatible con OpenAI." }, { status: 400 });
    // SSRF: una URL base arbitraria apunta a la red interna o a la IP de
    // metadata de la nube — ver lib/ia/validarUrlBase.ts (se revalida
    // otra vez antes de cada llamada real).
    try {
      await exigirUrlBaseIASegura(baseUrl);
    } catch (error) {
      if (error instanceof UrlBaseIAInvalidaError) return NextResponse.json({ error: error.message }, { status: 400 });
      throw error;
    }
  }
  return { nombre, proveedor, modelo, baseUrl: proveedor === "otro_compatible_openai" ? baseUrl : null, apiKey };
}
