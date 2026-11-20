import { NextResponse } from "next/server";
import { requierePermiso } from "@/lib/permisos";
import { obtenerConexionIAConClave } from "@/lib/ia/conexion";
import { ErrorIASinVision, ErrorProveedorIA, llamarIAConImagenes, type ImagenIA } from "@/lib/ia/proveedores";
import { creaContador, limpiarVencidos, superaLimite } from "@/lib/limite-peticiones";
import {
  construirPromptComparacion,
  esUrlMiniaturaPermitida,
  LIMITE_COMPARACIONES_POR_HORA,
  MAX_CANDIDATOS_COMPARAR,
  MENSAJE_IA_SIN_VISION,
  MENSAJE_SIN_IA,
  parsearComparacion,
  VENTANA_LIMITE_MS,
  type ResultadoComparacion,
} from "@/lib/ml/buscarPorFoto";
import { descargarMiniatura } from "@/lib/ml/miniaturasServidor";
import { leerImagen, resolverSesionYEmpresa, respuestaSiMuyGrande, respuestaSiSinPermiso } from "../_ayudantes";

// «Buscar por foto», paso 2 — compara la foto con las miniaturas del
// listado de Mercado Libre en UNA sola llamada a la IA de la empresa.
// Route Handler por el mismo motivo que ../route.ts (cuerpo de hasta 5 MB).
//
// El navegador manda la foto (otra vez, solo en memoria) y la lista
// {id, url}; el servidor NUNCA descarga una URL que no sea https en
// mlstatic.com (ver lib/ml/miniaturasServidor.ts). Nada se guarda ni se loguea.
const contador = creaContador();
let ultimaLimpieza = Date.now();

type CandidatoEntrada = { id: string; url: string };

function leerCandidatos(crudo: unknown): CandidatoEntrada[] | null {
  if (typeof crudo !== "string") return null;
  let lista: unknown;
  try {
    lista = JSON.parse(crudo);
  } catch {
    return null;
  }
  if (!Array.isArray(lista) || lista.length === 0 || lista.length > MAX_CANDIDATOS_COMPARAR) return null;
  const ids = new Set<string>();
  const resultado: CandidatoEntrada[] = [];
  for (const item of lista) {
    const o = item as { id?: unknown; url?: unknown } | null;
    if (!o || typeof o.id !== "string" || !/^c\d{1,2}$/.test(o.id) || ids.has(o.id)) return null;
    if (typeof o.url !== "string" || !esUrlMiniaturaPermitida(o.url)) return null;
    ids.add(o.id);
    resultado.push({ id: o.id, url: o.url });
  }
  return resultado;
}

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
  const muyGrande = respuestaSiMuyGrande(request, MAX_CANDIDATOS_COMPARAR * 1024);
  if (muyGrande) return muyGrande;

  const ahora = Date.now();
  if (ahora - ultimaLimpieza > VENTANA_LIMITE_MS) {
    limpiarVencidos(contador, VENTANA_LIMITE_MS, ahora);
    ultimaLimpieza = ahora;
  }
  if (superaLimite(contador, sesion.empresaId, LIMITE_COMPARACIONES_POR_HORA, VENTANA_LIMITE_MS, ahora)) {
    return NextResponse.json({ error: "Llegaste al límite de comparaciones por hora. Intenta más tarde." }, { status: 429 });
  }

  const conexion = await obtenerConexionIAConClave(sesion.empresaId);
  if (!conexion) return NextResponse.json({ error: MENSAJE_SIN_IA, codigo: "sin_ia" }, { status: 400 });

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return NextResponse.json({ error: "No se pudo leer la foto." }, { status: 400 });
  }
  const candidatos = leerCandidatos(form.get("candidatos"));
  if (!candidatos) return NextResponse.json({ error: "Lista de candidatos no válida." }, { status: 400 });
  const lectura = await leerImagen(form);
  if (lectura instanceof NextResponse) return lectura;

  const descargas = await Promise.all(candidatos.map(async (c) => ({ id: c.id, mini: await descargarMiniatura(c.url) })));
  const bajadas = descargas.filter((d): d is { id: string; mini: NonNullable<typeof d.mini> } => d.mini !== null);
  if (!bajadas.length) return NextResponse.json({ error: "No se pudieron bajar las miniaturas para comparar." }, { status: 502 });

  const imagenes: ImagenIA[] = [lectura.imagen, ...bajadas.map((b) => b.mini)];
  const ids = bajadas.map((b) => b.id);
  let texto: string;
  try {
    texto = await llamarIAConImagenes(conexion, construirPromptComparacion(ids), imagenes, { maxTokens: 900 });
  } catch (error) {
    if (error instanceof ErrorIASinVision) return NextResponse.json({ error: MENSAJE_IA_SIN_VISION, codigo: "sin_vision" }, { status: 422 });
    if (error instanceof ErrorProveedorIA) return NextResponse.json({ error: "La IA no respondió. Intenta de nuevo." }, { status: 502 });
    return NextResponse.json({ error: "No se pudo usar tu IA conectada. Revisa Configuración." }, { status: 500 });
  }

  const comparadas = parsearComparacion(texto, ids);
  if (!comparadas) return NextResponse.json({ error: "No pude leer la respuesta de la IA." }, { status: 502 });
  // Las miniaturas que no se pudieron bajar quedan «dudoso», nunca ocultas.
  const resultados: ResultadoComparacion[] = candidatos.map(
    (c) => comparadas.find((r) => r.id === c.id) ?? { id: c.id, veredicto: "dudoso", motivo: "No se pudo bajar la miniatura." }
  );
  return NextResponse.json({ resultados });
}
