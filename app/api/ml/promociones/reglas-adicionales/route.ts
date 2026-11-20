import { inArray } from "drizzle-orm";
import { NextResponse } from "next/server";
import { dbComoEmpresa } from "@/db/empresa-context";
import { promocionesReglas } from "@/db/schema";
import { listarCuentasConectadas } from "@/lib/ml/cuentas";
import { requierePermiso } from "@/lib/permisos";
import { LARGO_MAXIMO_REGLAS_TEXTO, tieneReglasAplicables, validarReglasAdicionales } from "@/lib/ml/promocionesReglasTexto";
import { urlPublicaBase } from "@/lib/url-publica";
import { PATRON_UUID, respuestaSiOrigenInvalido, respuestaSiSinPermiso, resolverSesionYEmpresa } from "../_ayudantes";

// PR 2 de Promociones — guardar / leer las «Reglas adicionales» de una
// cuenta. Solo aplican a la regla "tabla-maestra" (promocionesPublicaciones.ts).
// GET: "consultar". PUT: "aprobar" (mismo nivel que editar las reglas de
// una cuenta, ../reglas/route.ts). El PUT NUNCA guarda sin
// `confirmado: true` — la persona ya vio «Entendí esto / No entendí» — y
// SIEMPRE vuelve a validar el JSON en el servidor (nunca confía en lo que
// manda el navegador).

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
  const ids = cuentas.map((c) => c.id);
  const filasReglas = ids.length === 0 ? [] : await dbComoEmpresa(empresa.id, (tx) => tx.select().from(promocionesReglas).where(inArray(promocionesReglas.cuentaMlId, ids)));
  const porCuenta = new Map(filasReglas.map((f) => [f.cuentaMlId, f]));
  return NextResponse.json({
    filas: cuentas.map((c) => {
      const fila = porCuenta.get(c.id);
      return { cuentaId: c.id, nickname: c.nickname, reglaParticipacion: fila?.reglaParticipacion ?? null, texto: fila?.reglasAdicionalesTexto ?? null, json: fila?.reglasAdicionalesJson ?? null };
    }),
  });
}

type Cuerpo = { cuentaId?: unknown; texto?: unknown; json?: unknown; confirmado?: unknown };

export async function PUT(request: Request) {
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
  const { cuentaId, texto, json, confirmado } = cuerpo;
  if (confirmado !== true) return NextResponse.json({ error: "Falta la confirmación: revisa «Entendí esto» y confirma para guardar." }, { status: 400 });
  if (cuentaId !== "todas" && (typeof cuentaId !== "string" || !PATRON_UUID.test(cuentaId))) return NextResponse.json({ error: "Cuenta inválida." }, { status: 400 });
  if (typeof texto !== "string" || texto.length > LARGO_MAXIMO_REGLAS_TEXTO) {
    return NextResponse.json({ error: `El texto no puede pasar de ${LARGO_MAXIMO_REGLAS_TEXTO} caracteres.` }, { status: 400 });
  }

  // Texto vacío = borrar las reglas adicionales (también requiere confirmado).
  const borrar = texto.trim() === "";
  let reglasJson: unknown = null;
  if (!borrar) {
    const validado = validarReglasAdicionales(json);
    if (!validado.ok) return NextResponse.json({ error: `Las reglas interpretadas no son válidas: ${validado.error}` }, { status: 400 });
    if (!tieneReglasAplicables(validado.reglas)) return NextResponse.json({ error: "No hay ninguna regla entendida para guardar." }, { status: 400 });
    reglasJson = validado.reglas;
  }

  const cuentas = (await listarCuentasConectadas(empresa.id)).filter((c) => !c.desconectadaTs);
  const destino = cuentaId === "todas" ? cuentas : cuentas.filter((c) => c.id === cuentaId);
  if (destino.length === 0) return NextResponse.json({ error: "Cuenta no encontrada." }, { status: 404 });

  const campos = borrar
    ? { reglasAdicionalesTexto: null, reglasAdicionalesJson: null }
    : { reglasAdicionalesTexto: texto.trim(), reglasAdicionalesJson: reglasJson as NonNullable<typeof promocionesReglas.$inferInsert.reglasAdicionalesJson>, reglaParticipacion: "tabla-maestra" };

  await dbComoEmpresa(empresa.id, (tx) =>
    Promise.all(
      destino.map((c) =>
        tx
          .insert(promocionesReglas)
          .values({ empresaId: empresa.id, cuentaMlId: c.id, ...campos, actualizadoPor: usuario.id })
          // Solo estas columnas: los valores de descuento máximo, compartidas, etc. de la cuenta quedan intactos.
          .onConflictDoUpdate({ target: promocionesReglas.cuentaMlId, set: { ...campos, actualizadoTs: new Date(), actualizadoPor: usuario.id } })
      )
    )
  );

  return NextResponse.json({ ok: true, cuentasActualizadas: destino.length, borradas: borrar });
}
