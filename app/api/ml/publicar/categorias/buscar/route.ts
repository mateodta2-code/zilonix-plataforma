import { cookies } from "next/headers";
import { NextRequest, NextResponse } from "next/server";
import { listarEmpresasDeUsuario } from "@/lib/empresas";
import { obtenerOCrearUsuarioActual } from "@/lib/usuarios";
import { requierePermiso } from "@/lib/permisos";
import { SITE_ID } from "@/lib/ml/cliente";
import { obtenerAccessTokenVigente } from "@/lib/ml/cuentas";
import { buscarCategorias } from "@/lib/ml/publicar";

// ADENDO UX de Publicar, punto 2 — "buscador de categoría sobre
// buscarCategorias de lib/ml/publicar.ts" (ya existía como función,
// solo le faltaba una ruta para que el formulario la pudiera llamar).
// Mismo permiso que crear el producto en sí ("inventario","crear") —
// esto solo AYUDA a elegir la categoría, nunca publica nada. `cuentaId`
// decide de qué cuenta sale el token (obtenerAccessTokenVigente, nunca
// un token de vendedor nuevo ni refrescado fuera de ese helper ya
// probado) — site_id es siempre SITE_ID ("MCO", único país en alcance,
// ver lib/ml/cliente.ts).
export async function GET(request: NextRequest) {
  const usuario = await obtenerOCrearUsuarioActual();
  if (!usuario) return NextResponse.json({ error: "Sin sesión." }, { status: 401 });

  const propias = await listarEmpresasDeUsuario(usuario.id);
  const empresaId = cookies().get("empresa_actual")?.value;
  const empresa = propias.find((e) => e.id === empresaId) ?? propias[0];
  if (!empresa) return NextResponse.json({ error: "Sin empresa activa." }, { status: 400 });

  await requierePermiso(usuario.id, empresa.id, "inventario", "crear");

  const cuentaId = request.nextUrl.searchParams.get("cuentaId");
  const texto = request.nextUrl.searchParams.get("texto")?.trim();
  if (!cuentaId || !texto) return NextResponse.json({ error: "Faltan cuentaId/texto." }, { status: 400 });

  try {
    const token = await obtenerAccessTokenVigente(empresa.id, cuentaId);
    const resultados = await buscarCategorias(SITE_ID, texto, token);
    return NextResponse.json({ resultados });
  } catch (error) {
    const mensaje = error instanceof Error ? error.message : "Error buscando categorías.";
    return NextResponse.json({ error: mensaje }, { status: 502 });
  }
}
