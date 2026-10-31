import { cookies } from "next/headers";
import { NextRequest, NextResponse } from "next/server";
import { listarEmpresasDeUsuario } from "@/lib/empresas";
import { obtenerOCrearUsuarioActual } from "@/lib/usuarios";
import { requierePermiso } from "@/lib/permisos";
import { obtenerAccessTokenVigente, obtenerSitioDeCuenta } from "@/lib/ml/cuentas";
import { buscarCategorias } from "@/lib/ml/publicar";
import { respuestaDeErrorMl, respuestaSiCuentaIdInvalido, respuestaSiSinPermiso } from "../../_ayudantes";

// ADENDO UX de Publicar, punto 2 — "buscador de categoría sobre
// buscarCategorias de lib/ml/publicar.ts" (ya existía como función,
// solo le faltaba una ruta para que el formulario la pudiera llamar).
// Mismo permiso que crear el producto en sí ("inventario","crear") —
// esto solo AYUDA a elegir la categoría, nunca publica nada. `cuentaId`
// decide de qué cuenta sale el token (obtenerAccessTokenVigente, nunca
// un token de vendedor nuevo ni refrescado fuera de ese helper ya
// probado) — issue #315: el site_id ya no es fijo, se resuelve de ESA
// cuenta (obtenerSitioDeCuenta, lib/ml/cuentas.ts), nunca el "MCO" de
// lib/ml/cliente.ts.
export async function GET(request: NextRequest) {
  const usuario = await obtenerOCrearUsuarioActual();
  if (!usuario) return NextResponse.json({ error: "Sin sesión." }, { status: 401 });

  const propias = await listarEmpresasDeUsuario(usuario.id);
  const empresaId = cookies().get("empresa_actual")?.value;
  const empresa = propias.find((e) => e.id === empresaId) ?? propias[0];
  if (!empresa) return NextResponse.json({ error: "Sin empresa activa." }, { status: 400 });

  try {
    await requierePermiso(usuario.id, empresa.id, "inventario", "crear");
  } catch (error) {
    const respuestaPermiso = respuestaSiSinPermiso(error);
    if (respuestaPermiso) return respuestaPermiso;
    throw error;
  }

  const cuentaId = request.nextUrl.searchParams.get("cuentaId");
  const texto = request.nextUrl.searchParams.get("texto")?.trim();
  // Code review de Pablo, punto 2 — formato de cuentaId validado ANTES
  // de tocar la base (esta ruta no recibe categoryId).
  const respuestaId = respuestaSiCuentaIdInvalido(cuentaId);
  if (respuestaId) return respuestaId;
  if (!texto) return NextResponse.json({ error: "Falta texto." }, { status: 400 });

  try {
    const token = await obtenerAccessTokenVigente(empresa.id, cuentaId as string);
    const { siteId } = await obtenerSitioDeCuenta(empresa.id, cuentaId as string);
    const resultados = await buscarCategorias(siteId, texto, token);
    return NextResponse.json({ resultados });
  } catch (error) {
    return respuestaDeErrorMl(error);
  }
}
