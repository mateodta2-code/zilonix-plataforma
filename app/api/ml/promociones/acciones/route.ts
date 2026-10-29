import { eq, inArray } from "drizzle-orm";
import { NextResponse } from "next/server";
import { dbComoEmpresa } from "@/db/empresa-context";
import { promocionesAcciones, promocionesCandidatos } from "@/db/schema";
import { requierePermiso } from "@/lib/permisos";
import { tienePermiso } from "@/lib/roles-plantillas";
import { obtenerAccessTokenVigente } from "@/lib/ml/cuentas";
import { modificarPromocionMl, participarPromocionMl, salirDePromocionMl } from "@/lib/ml/cliente";
import { fechasParaParticipar, TIPOS_SIN_ESCRITURA_API } from "@/lib/ml/promociones";
import { urlPublicaBase } from "@/lib/url-publica";
import { PATRON_UUID, respuestaSiOrigenInvalido, respuestaSiSinPermiso, resolverSesionYEmpresa } from "../_ayudantes";

// Rama feat-promociones, punto 3/5 — "nada se aplica en ML sin ese
// clic de confirmación". Un solo endpoint para el lote completo:
// SIEMPRE exige "aprobar" (marca las acciones como aceptadas y queda
// en el historial); si quien llama TAMBIÉN tiene "ejecutar", sigue de
// una vez y dispara el cambio real contra Mercado Libre — si no, el
// lote queda "aceptada", pendiente de que alguien con permiso de
// ejecutar lo dispare después (2 pasos humanos reales, decisión de
// Mateo). "modoSimulacion" nunca llega a tocar Mercado Libre, pase lo
// que pase con el permiso de ejecutar — calcula y deja registro igual,
// para que se vea qué se habría hecho.
//
// Punto 5 — "si una cuenta falla al aplicar, esa cuenta se detiene y
// las demás siguen": el corte es por CUENTA, nunca global.
const TIPO_ACCION = ["participar", "modificar", "salir"] as const;
type TipoAccion = (typeof TIPO_ACCION)[number];

type Decision = { candidatoId: string; accion: TipoAccion };

function parsearDecisiones(cuerpo: unknown): Decision[] | null {
  const lista = (cuerpo as { decisiones?: unknown })?.decisiones;
  if (!Array.isArray(lista) || lista.length === 0) return null;
  const resultado: Decision[] = [];
  for (const fila of lista) {
    const candidatoId = (fila as { candidatoId?: unknown })?.candidatoId;
    const accion = (fila as { accion?: unknown })?.accion;
    if (typeof candidatoId !== "string" || !PATRON_UUID.test(candidatoId)) return null;
    if (typeof accion !== "string" || !(TIPO_ACCION as readonly string[]).includes(accion)) return null;
    resultado.push({ candidatoId, accion: accion as TipoAccion });
  }
  return resultado;
}

export async function POST(request: Request) {
  const base = urlPublicaBase();
  const respuestaOrigen = respuestaSiOrigenInvalido(request, new URL(base).origin);
  if (respuestaOrigen) return respuestaOrigen;

  const sesion = await resolverSesionYEmpresa();
  if (sesion instanceof NextResponse) return sesion;
  const { usuario, empresa } = sesion;

  let miMembresia;
  try {
    miMembresia = await requierePermiso(usuario.id, empresa.id, "promociones", "aprobar");
  } catch (error) {
    const respuestaPermiso = respuestaSiSinPermiso(error);
    if (respuestaPermiso) return respuestaPermiso;
    throw error;
  }
  const puedeEjecutar = tienePermiso(miMembresia.permisos, "promociones", "ejecutar");

  let cuerpo: unknown;
  try {
    cuerpo = await request.json();
  } catch {
    return NextResponse.json({ error: "Faltan datos." }, { status: 400 });
  }
  const decisiones = parsearDecisiones(cuerpo);
  if (!decisiones) return NextResponse.json({ error: "Faltan datos." }, { status: 400 });
  const modoSimulacion = (cuerpo as { modoSimulacion?: unknown })?.modoSimulacion === true;

  const candidatoIds = decisiones.map((d) => d.candidatoId);
  const candidatos = await dbComoEmpresa(empresa.id, (tx) =>
    tx.select().from(promocionesCandidatos).where(inArray(promocionesCandidatos.id, candidatoIds))
  );
  const candidatoPorId = new Map(candidatos.map((c) => [c.id, c]));

  // Insertar las filas de historial — SIEMPRE, como "aceptada" (el
  // permiso "aprobar" ya se confirmó arriba). Se agrupan por cuenta
  // para poder "detener esa cuenta, las demás siguen" al ejecutar.
  const filasCreadas: (typeof promocionesAcciones.$inferSelect)[] = [];
  for (const decision of decisiones) {
    const candidato = candidatoPorId.get(decision.candidatoId);
    if (!candidato) continue; // candidatoId que no existe o es de otra empresa (RLS) — se ignora, nunca rompe el resto
    const [fila] = await dbComoEmpresa(empresa.id, (tx) =>
      tx
        .insert(promocionesAcciones)
        .values({
          empresaId: empresa.id,
          cuentaMlId: candidato.cuentaMlId,
          itemId: candidato.itemId,
          tituloProducto: candidato.tituloProducto,
          tipoPromocion: candidato.tipoPromocion,
          promotionIdMl: candidato.promotionIdMl,
          accion: decision.accion,
          precioAntes: candidato.precioActual,
          precioDespues: decision.accion === "salir" ? null : candidato.precioSugerido,
          estado: "aceptada",
          aprobadoPor: usuario.id,
          aprobadoTs: new Date(),
          modoSimulacion,
        })
        .returning()
    );
    filasCreadas.push(fila);
  }

  if (modoSimulacion || !puedeEjecutar) {
    return NextResponse.json({ ok: true, acciones: filasCreadas, ejecutado: false });
  }

  // Ejecutar de verdad — agrupado por cuenta, token por cuenta, se
  // detiene esa cuenta puntual si una acción falla (nunca el resto).
  const porCuenta = new Map<string, typeof filasCreadas>();
  for (const fila of filasCreadas) {
    if (fila.tipoPromocion && TIPOS_SIN_ESCRITURA_API.includes(fila.tipoPromocion)) continue; // nunca se intenta, queda "aceptada"
    if (!porCuenta.has(fila.cuentaMlId)) porCuenta.set(fila.cuentaMlId, []);
    porCuenta.get(fila.cuentaMlId)!.push(fila);
  }

  const resultados = await Promise.all(
    [...porCuenta.entries()].map(async ([cuentaMlId, filasCuenta]) => {
      let token: string;
      try {
        token = await obtenerAccessTokenVigente(empresa.id, cuentaMlId);
      } catch (error) {
        return filasCuenta.map((f) => ({ id: f.id, estado: "fallida" as const, error: error instanceof Error ? error.message : "No se pudo obtener el token.", resultadoMl: null }));
      }

      const salidas: { id: string; estado: "ejecutada" | "fallida"; error: string | null; resultadoMl: unknown }[] = [];
      for (const fila of filasCuenta) {
        try {
          let respuestaMl: { ok: boolean; status: number; textoCrudo: string };
          if (fila.accion === "participar") {
            // El snapshot (promociones_candidatos) nunca guardó las
            // fechas reales de la promoción de Mercado Libre (solo lo
            // que hace falta para decidir el precio) — fechasParaParticipar
            // con un objeto vacío cae directo al respaldo real (hoy →
            // fin de mes), el mismo que usaría si la promoción no
            // traía fechas propias.
            const { fechaInicio, fechaFin } = fechasParaParticipar({});
            respuestaMl = await participarPromocionMl(fila.itemId, token, {
              promotion_id: fila.promotionIdMl ?? "",
              promotion_type: fila.tipoPromocion,
              deal_price: Number(fila.precioDespues),
              start_date: fechaInicio,
              finish_date: fechaFin,
            });
          } else if (fila.accion === "modificar") {
            respuestaMl = await modificarPromocionMl(fila.itemId, token, {
              promotion_id: fila.promotionIdMl ?? "",
              promotion_type: fila.tipoPromocion,
              deal_price: Number(fila.precioDespues),
            });
          } else {
            respuestaMl = await salirDePromocionMl(fila.itemId, token, fila.promotionIdMl ?? "", fila.tipoPromocion);
          }

          const estado = respuestaMl.ok ? "ejecutada" : "fallida";
          salidas.push({ id: fila.id, estado, error: respuestaMl.ok ? null : `Mercado Libre respondió ${respuestaMl.status}.`, resultadoMl: { ok: respuestaMl.ok, status: respuestaMl.status, respuesta: respuestaMl.textoCrudo.slice(0, 500) } });
          if (!respuestaMl.ok) break; // esta cuenta se detiene; las demás ya corren en paralelo, siguen de largo
        } catch (error) {
          salidas.push({ id: fila.id, estado: "fallida", error: error instanceof Error ? error.message.slice(0, 400) : "No se pudo ejecutar.", resultadoMl: null });
          break;
        }
      }
      return salidas;
    })
  );

  const planas = resultados.flat();
  await Promise.all(
    planas.map((r) =>
      dbComoEmpresa(empresa.id, (tx) =>
        tx
          .update(promocionesAcciones)
          .set({ estado: r.estado, ejecutadoPor: usuario.id, ejecutadoTs: new Date(), resultadoMl: r.resultadoMl, error: r.error })
          .where(eq(promocionesAcciones.id, r.id))
      )
    )
  );

  return NextResponse.json({ ok: true, acciones: filasCreadas.map((f) => ({ ...f, resultado: planas.find((r) => r.id === f.id) ?? null })), ejecutado: true });
}
