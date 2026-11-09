import { NextResponse } from "next/server";
import { requierePermiso } from "@/lib/permisos";
import { listarPublicacionesConEstado, type FiltroPublicaciones } from "@/lib/ml/promocionesPublicaciones";
import { PATRON_UUID, respuestaSiSinPermiso, resolverSesionYEmpresa } from "../_ayudantes";

// Tarea "Promociones real" (Refs #295) — la lista nueva de la maqueta
// aprobada: TODAS las publicaciones (en_promocion/sin_promocion/error),
// leídas EN VIVO contra Mercado Libre, página por página (ver el
// comentario grande en lib/ml/promocionesPublicaciones.ts sobre por
// qué no hay un snapshot completo en base — decisión explícita de
// Mateo para no agregar una migración). Solo lectura — permiso
// "consultar", igual que /candidatos.
const FILTROS: FiltroPublicaciones[] = ["todas", "en-promocion", "sin-promocion", "con-error"];
const TAMANO_PAGINA_DEFECTO = 20;
const TAMANO_PAGINA_MAXIMO = 50;

export async function GET(request: Request) {
  const sesion = await resolverSesionYEmpresa();
  if (sesion instanceof NextResponse) return sesion;
  const { usuario, empresa } = sesion;

  try {
    await requierePermiso(usuario.id, empresa.id, "promociones", "consultar");
  } catch (error) {
    const respuesta = respuestaSiSinPermiso(error);
    if (respuesta) return respuesta;
    throw error;
  }

  const url = new URL(request.url);
  const cuentaIdParam = url.searchParams.get("cuentaId") ?? "todas";
  if (cuentaIdParam !== "todas" && !PATRON_UUID.test(cuentaIdParam)) {
    return NextResponse.json({ error: "Cuenta inválida." }, { status: 400 });
  }
  const filtroParam = url.searchParams.get("filtro") ?? "todas";
  if (!FILTROS.includes(filtroParam as FiltroPublicaciones)) {
    return NextResponse.json({ error: "Filtro inválido." }, { status: 400 });
  }
  const buscar = (url.searchParams.get("buscar") ?? "").slice(0, 200);
  const cursor = url.searchParams.get("cursor");
  const tamanoPaginaParam = Number(url.searchParams.get("tamanoPagina") ?? TAMANO_PAGINA_DEFECTO);
  const tamanoPagina = Number.isFinite(tamanoPaginaParam) && tamanoPaginaParam > 0 ? Math.min(Math.trunc(tamanoPaginaParam), TAMANO_PAGINA_MAXIMO) : TAMANO_PAGINA_DEFECTO;

  const resultado = await listarPublicacionesConEstado(empresa.id, {
    cuentaId: cuentaIdParam,
    filtro: filtroParam as FiltroPublicaciones,
    buscar,
    cursor,
    tamanoPagina,
  });

  return NextResponse.json(resultado);
}
