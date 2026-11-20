import { NextResponse } from "next/server";
import { creaContador, superaLimite } from "@/lib/limite-peticiones";
import { requierePermiso } from "@/lib/permisos";
import { interpretarReglasTexto } from "@/lib/ml/promocionesReglasTextoIA";
import { LARGO_MAXIMO_REGLAS_TEXTO } from "@/lib/ml/promocionesReglasTexto";
import { urlPublicaBase } from "@/lib/url-publica";
import { respuestaSiOrigenInvalido, respuestaSiSinPermiso, resolverSesionYEmpresa } from "../../_ayudantes";

// PR 2 de Promociones — «Interpretar» las reglas adicionales. NO ESCRIBE
// NADA (ni base de datos ni Mercado Libre): llama a la IA de la propia
// empresa una vez y devuelve { entendido, noEntendido, json } para que la
// persona confirme. Permiso "aprobar" (el mismo que editar las reglas de
// una cuenta, ver ../../reglas/route.ts), porque gasta la llave de IA de
// la empresa. Límite de frecuencia por empresa (en memoria, igual que
// lib/limite-peticiones.ts): el costo es de la empresa, pero un bucle
// no debería poder dispararlo sin freno.
const LIMITE_POR_MINUTO = 6;
const VENTANA_MS = 60_000;
const contador = creaContador();

type Cuerpo = { texto?: unknown };

export async function POST(request: Request) {
  const base = urlPublicaBase();
  const respuestaOrigen = respuestaSiOrigenInvalido(request, new URL(base).origin);
  if (respuestaOrigen) return respuestaOrigen;

  const sesion = await resolverSesionYEmpresa();
  if (sesion instanceof NextResponse) return sesion;
  const { usuario, empresa } = sesion;

  try {
    await requierePermiso(usuario.id, empresa.id, "promociones", "aprobar");
  } catch (error) {
    const respuestaPermiso = respuestaSiSinPermiso(error);
    if (respuestaPermiso) return respuestaPermiso;
    throw error;
  }

  let cuerpo: Cuerpo;
  try {
    cuerpo = await request.json();
  } catch {
    return NextResponse.json({ error: "Faltan datos." }, { status: 400 });
  }
  if (typeof cuerpo.texto !== "string" || cuerpo.texto.trim() === "") return NextResponse.json({ error: "Escribe al menos una regla." }, { status: 400 });
  if (cuerpo.texto.length > LARGO_MAXIMO_REGLAS_TEXTO) {
    return NextResponse.json({ error: `El texto no puede pasar de ${LARGO_MAXIMO_REGLAS_TEXTO} caracteres.` }, { status: 400 });
  }

  if (superaLimite(contador, empresa.id, LIMITE_POR_MINUTO, VENTANA_MS)) {
    return NextResponse.json({ error: "Demasiadas interpretaciones seguidas — espera un minuto e intenta de nuevo." }, { status: 429 });
  }

  const resultado = await interpretarReglasTexto(empresa.id, cuerpo.texto);
  if (resultado.estado === "sin_ia") return NextResponse.json({ error: resultado.mensaje, codigo: "sin_ia" }, { status: 409 });
  if (resultado.estado === "invalido") return NextResponse.json({ error: resultado.mensaje }, { status: 400 });
  if (resultado.estado === "error_ia") return NextResponse.json({ error: resultado.mensaje, codigo: "error_ia" }, { status: 502 });
  return NextResponse.json({ entendido: resultado.entendido, noEntendido: resultado.noEntendido, json: resultado.reglas });
}
