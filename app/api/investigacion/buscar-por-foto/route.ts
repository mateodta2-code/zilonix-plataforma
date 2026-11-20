import { NextResponse } from "next/server";
import { requierePermiso } from "@/lib/permisos";
import { obtenerConexionIAParaModulo } from "@/lib/ia/conexion";
import { ErrorIASinVision, ErrorProveedorIA, llamarIAConImagenes } from "@/lib/ia/proveedores";
import { creaContador, limpiarVencidos, superaLimite } from "@/lib/limite-peticiones";
import {
  construirConsultas,
  construirPromptReconocimiento,
  esConfianzaBaja,
  esPaisFotoValido,
  LIMITE_FOTOS_POR_HORA,
  MENSAJE_IA_SIN_VISION,
  MENSAJE_NO_RECONOCIDO,
  MENSAJE_SIN_IA,
  parsearReconocimiento,
  VENTANA_LIMITE_MS,
} from "@/lib/ml/buscarPorFoto";
import { leerImagen, resolverSesionYEmpresa, respuestaSiMuyGrande, respuestaSiSinPermiso } from "./_ayudantes";

// «Buscar por foto» — reconoce el producto de una foto con la IA que la
// propia empresa conectó (nunca la llave de la plataforma: Zilonix no
// paga este costo).
//
// Es un Route Handler y no una Server Action a propósito: las Server
// Actions de Next solo aceptan cuerpos de ~1 MB y una foto puede pesar
// hasta 5 MB (CLAUDE.md: Route Handler solo cuando la Server Action no
// alcanza).
//
// PRIVACIDAD: la imagen vive únicamente en la memoria de esta petición.
// No se escribe a disco, base de datos ni logs (tampoco se loguea el
// error del proveedor, que podría citar el contenido).
//
// Límite por empresa en memoria del proceso (mismo criterio que
// lib/limite-peticiones.ts: un solo proceso `web` hoy).
const contador = creaContador();
let ultimaLimpieza = Date.now();

export async function POST(request: Request) {
  const sesion = await resolverSesionYEmpresa(request);
  if (sesion instanceof NextResponse) return sesion;
  try {
    await requierePermiso(sesion.usuarioId, sesion.empresaId, "inventario", "consultar");
  } catch (error) {
    const sinPermiso = respuestaSiSinPermiso(error);
    if (sinPermiso) return sinPermiso;
    throw error;
  }
  const muyGrande = respuestaSiMuyGrande(request);
  if (muyGrande) return muyGrande;

  const ahora = Date.now();
  if (ahora - ultimaLimpieza > VENTANA_LIMITE_MS) {
    limpiarVencidos(contador, VENTANA_LIMITE_MS, ahora);
    ultimaLimpieza = ahora;
  }
  if (superaLimite(contador, sesion.empresaId, LIMITE_FOTOS_POR_HORA, VENTANA_LIMITE_MS, ahora)) {
    return NextResponse.json({ error: `Llegaste al límite de ${LIMITE_FOTOS_POR_HORA} fotos por hora. Intenta más tarde.` }, { status: 429 });
  }

  const conexion = await obtenerConexionIAParaModulo(sesion.empresaId, "investigacion");
  if (!conexion) return NextResponse.json({ error: MENSAJE_SIN_IA, codigo: "sin_ia" }, { status: 400 });

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return NextResponse.json({ error: "No se pudo leer la foto." }, { status: 400 });
  }
  const pais = form.get("pais");
  if (!esPaisFotoValido(pais)) return NextResponse.json({ error: "País no válido." }, { status: 400 });
  const lectura = await leerImagen(form);
  if (lectura instanceof NextResponse) return lectura;

  let texto: string;
  try {
    texto = await llamarIAConImagenes(conexion, construirPromptReconocimiento(pais), [lectura.imagen], { maxTokens: 600 });
  } catch (error) {
    if (error instanceof ErrorIASinVision) return NextResponse.json({ error: MENSAJE_IA_SIN_VISION, codigo: "sin_vision" }, { status: 422 });
    if (error instanceof ErrorProveedorIA) return NextResponse.json({ error: "La IA no respondió. Intenta de nuevo." }, { status: 502 });
    return NextResponse.json({ error: "No se pudo usar tu IA conectada. Revisa Configuración." }, { status: 500 });
  }

  const reconocimiento = parsearReconocimiento(texto);
  if (!reconocimiento) return NextResponse.json({ error: MENSAJE_NO_RECONOCIDO }, { status: 422 });
  const { termino, consultas } = construirConsultas(reconocimiento);
  return NextResponse.json({ reconocimiento, termino, consultas, confianzaBaja: esConfianzaBaja(reconocimiento.confianza) });
}
