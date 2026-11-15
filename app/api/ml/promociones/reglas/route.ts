import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { dbComoEmpresa } from "@/db/empresa-context";
import { promocionesReglas } from "@/db/schema";
import { requierePermiso } from "@/lib/permisos";
import { listarCuentasConectadas } from "@/lib/ml/cuentas";
import { urlPublicaBase } from "@/lib/url-publica";
import { PATRON_UUID, respuestaSiOrigenInvalido, respuestaSiSinPermiso, resolverSesionYEmpresa } from "../_ayudantes";

// Rama feat-promociones, punto 2 — "Reglas por cuenta". GET devuelve
// las reglas de TODAS las cuentas conectadas (con los valores por
// defecto de la migración para la que todavía no tiene fila propia,
// nunca null a la UI). PUT guarda las reglas de UNA cuenta — con
// `copiarATodas` opcional, que las replica al resto de las cuentas
// conectadas en un solo clic ("Usar las mismas reglas para todas las
// cuentas"), una COPIA real de ese momento, nunca un vínculo que las
// mantenga sincronizadas después.
const REGLAS_POR_DEFECTO = { descuentoMaximoPct: 20, participarCompartidas: false, igualarAlPiso: true, busquedaAutomaticaHora: null as string | null };

export async function GET() {
  const sesion = await resolverSesionYEmpresa();
  if (sesion instanceof NextResponse) return sesion;
  const { usuario, empresa } = sesion;

  try {
    await requierePermiso(usuario.id, empresa.id, "promociones", "consultar");
  } catch (error) {
    const respuestaPermiso = respuestaSiSinPermiso(error);
    if (respuestaPermiso) return respuestaPermiso;
    throw error;
  }

  const cuentas = (await listarCuentasConectadas(empresa.id)).filter((c) => !c.desconectadaTs);
  const filasReglas = await dbComoEmpresa(empresa.id, (tx) => tx.select().from(promocionesReglas).where(eq(promocionesReglas.empresaId, empresa.id)));
  const reglasPorCuenta = new Map(filasReglas.map((f) => [f.cuentaMlId, f]));

  const filas = cuentas.map((c) => {
    const fila = reglasPorCuenta.get(c.id);
    return {
      cuentaId: c.id,
      nickname: c.nickname,
      descuentoMaximoPct: fila?.descuentoMaximoPct ?? REGLAS_POR_DEFECTO.descuentoMaximoPct,
      participarCompartidas: fila?.participarCompartidas ?? REGLAS_POR_DEFECTO.participarCompartidas,
      igualarAlPiso: fila?.igualarAlPiso ?? REGLAS_POR_DEFECTO.igualarAlPiso,
      busquedaAutomaticaHora: fila?.busquedaAutomaticaHora ?? REGLAS_POR_DEFECTO.busquedaAutomaticaHora,
    };
  });
  return NextResponse.json({ filas });
}

type DatosReglas = { descuentoMaximoPct: number; participarCompartidas: boolean; igualarAlPiso: boolean; busquedaAutomaticaHora: string | null };

const PATRON_HORA = /^([01]\d|2[0-3]):([0-5]\d)$/;

function validarReglas(cuerpo: unknown): DatosReglas | null {
  const c = cuerpo as Record<string, unknown>;
  if (typeof c?.descuentoMaximoPct !== "number" || c.descuentoMaximoPct <= 0 || c.descuentoMaximoPct > 100) return null;
  if (typeof c?.participarCompartidas !== "boolean") return null;
  if (typeof c?.igualarAlPiso !== "boolean") return null;
  const hora = c?.busquedaAutomaticaHora;
  if (hora != null && (typeof hora !== "string" || !PATRON_HORA.test(hora))) return null;
  return {
    descuentoMaximoPct: Math.round(c.descuentoMaximoPct),
    participarCompartidas: c.participarCompartidas,
    igualarAlPiso: c.igualarAlPiso,
    busquedaAutomaticaHora: (hora as string | null) ?? null,
  };
}

async function guardarReglasCuenta(empresaId: string, usuarioId: string, cuentaMlId: string, datos: DatosReglas): Promise<void> {
  await dbComoEmpresa(empresaId, (tx) =>
    tx
      .insert(promocionesReglas)
      .values({ empresaId, cuentaMlId, ...datos, actualizadoPor: usuarioId })
      .onConflictDoUpdate({ target: promocionesReglas.cuentaMlId, set: { ...datos, actualizadoTs: new Date(), actualizadoPor: usuarioId } })
  );
}

export async function PUT(request: Request) {
  const base = urlPublicaBase();
  const respuestaOrigen = respuestaSiOrigenInvalido(request, new URL(base).origin);
  if (respuestaOrigen) return respuestaOrigen;

  const sesion = await resolverSesionYEmpresa();
  if (sesion instanceof NextResponse) return sesion;
  const { usuario, empresa } = sesion;

  // Editar reglas es una decisión sobre cómo opera la cuenta, no una
  // simple consulta — se exige "aprobar" (mismo permiso que decidir
  // Sí/No sobre una propuesta), nunca "consultar".
  try {
    await requierePermiso(usuario.id, empresa.id, "promociones", "aprobar");
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
  const cuentaId = typeof (cuerpo as { cuentaId?: unknown })?.cuentaId === "string" ? (cuerpo as { cuentaId: string }).cuentaId : "";
  if (!PATRON_UUID.test(cuentaId)) return NextResponse.json({ error: "cuentaId inválido." }, { status: 400 });
  const datos = validarReglas(cuerpo);
  if (!datos) return NextResponse.json({ error: "Reglas inválidas." }, { status: 400 });
  const copiarATodas = (cuerpo as { copiarATodas?: unknown })?.copiarATodas === true;

  const cuentasConectadas = (await listarCuentasConectadas(empresa.id)).filter((c) => !c.desconectadaTs);
  const cuentaValida = cuentasConectadas.find((c) => c.id === cuentaId);
  if (!cuentaValida) return NextResponse.json({ error: "Esa cuenta no está conectada en esta empresa." }, { status: 400 });

  const destinos = copiarATodas ? cuentasConectadas : [cuentaValida];
  await Promise.all(destinos.map((c) => guardarReglasCuenta(empresa.id, usuario.id, c.id, datos)));

  return NextResponse.json({ ok: true, cuentasActualizadas: destinos.length });
}
