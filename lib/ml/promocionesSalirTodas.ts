import { dbComoEmpresa } from "@/db/empresa-context";
import { conReglaYOrigen, nuevoLoteBitacora, resultadoMlOmitida } from "./promocionesBitacora";
import { promocionesAcciones } from "@/db/schema";
import { conConcurrenciaLimitada } from "@/lib/concurrencia";
import { leerItemParaPromocionMl, leerPromocionesItemMl, motivoErrorEscrituraMl, type PromocionCrudaMl } from "@/lib/ml/cliente";
import { obtenerAccessTokenVigente } from "@/lib/ml/cuentas";
import { puedeSalirPorApi } from "@/lib/ml/promociones";
import { conReintento429Lectura, listarCuentasParaPublicaciones, TAMANO_LOTE_ML, TOPE_CONCURRENCIA_APLICAR_REGLA } from "@/lib/ml/promocionesPublicaciones";
import { salirDePromocionConReintento } from "@/lib/ml/promocionesSalir";
import { agruparPorCuenta, type ItemSeleccionado } from "@/lib/ml/promocionesSeleccion";

// Regla «Dejar de participar en todas las promociones» (Mateo) — sin
// migración: nada se guarda como "modo". Dos pasos, ambos en vivo:
//
//  1. vistaPreviaSalirTodas — SOLO LEE (publicaciones activas de la
//     cuenta + sus promociones started/pending) y cuenta. Nunca escribe.
//  2. salirDeTodasLasPromociones — hace el DELETE documentado de
//     seller-promotions por cada promoción activa, reusando la misma
//     función de la salida individual (promocionesSalir.ts).
//
// Restricciones documentadas (TIPOS_SALIR_API, lib/ml/promociones.ts):
// DOD, LIGHTNING y SELLER_CAMPAIGN —este último borraría la campaña
// ENTERA— y cualquier tipo desconocido NUNCA se llaman por API: se
// reportan como "No se puede salir por API" (no como error).

const ESTADOS_ACTIVOS = ["started", "pending"];

function esActiva(p: PromocionCrudaMl): boolean {
  return typeof p.status === "string" && ESTADOS_ACTIVOS.includes(p.status);
}

function tipoDe(p: PromocionCrudaMl): string {
  return typeof p.type === "string" && p.type ? p.type : "desconocido";
}

export type VistaPreviaSalirTodas = {
  revisadas: number; // publicaciones activas leídas
  publicaciones: number; // con al menos una promoción activa → saldrían
  promociones: number; // promociones activas en total
  salibles: number; // de esas, las que sí se pueden dejar por API
  noPermitidas: number; // las que solo se dejan desde la Central de Promociones de ML
  lecturasConError: number; // publicaciones que no se pudieron leer (no se cuentan)
  porTipo: Record<string, number>;
};

// Recorre SOLO las publicaciones elegidas (Promo-A, Refs #571; nunca el
// catálogo) en tandas de TAMANO_LOTE_ML, y le entrega a `porItem` cada una
// junto con sus promociones activas. Lo comparten la vista previa y la
// ejecución — la misma lectura, así lo que se cuenta es lo que se hace.
async function recorrerPublicacionesConPromos(
  empresaId: string,
  seleccion: ItemSeleccionado[],
  porItem: (ctx: { cuenta: { id: string; nickname: string }; token: string; itemId: string; activas: PromocionCrudaMl[] }) => Promise<void>,
  alLeer: (resultado: "leida" | "error") => void
): Promise<void> {
  const grupos = agruparPorCuenta(seleccion);
  const cuentas = (await listarCuentasParaPublicaciones(empresaId, "todas")).filter((c) => grupos.has(c.id));
  for (const cuenta of cuentas) {
    let token: string;
    try {
      token = await obtenerAccessTokenVigente(empresaId, cuenta.id);
    } catch {
      continue; // una cuenta sin token válido nunca frena a las demás
    }
    const ids = grupos.get(cuenta.id) ?? [];
    for (let desde = 0; desde < ids.length; desde += TAMANO_LOTE_ML) {
      const lote = ids.slice(desde, desde + TAMANO_LOTE_ML);

      await conConcurrenciaLimitada(lote, TOPE_CONCURRENCIA_APLICAR_REGLA, async (itemId) => {
        let activas: PromocionCrudaMl[];
        try {
          const lectura = await conReintento429Lectura(() => leerPromocionesItemMl(itemId, token));
          if (lectura.estado !== "ok") {
            alLeer("error");
            return;
          }
          activas = lectura.promociones.filter(esActiva);
        } catch {
          alLeer("error");
          return;
        }
        alLeer("leida");
        if (activas.length === 0) return;
        await porItem({ cuenta, token, itemId, activas });
      });
    }
  }
}

export async function vistaPreviaSalirTodas(empresaId: string, seleccion: ItemSeleccionado[]): Promise<VistaPreviaSalirTodas> {
  const vista: VistaPreviaSalirTodas = { revisadas: 0, publicaciones: 0, promociones: 0, salibles: 0, noPermitidas: 0, lecturasConError: 0, porTipo: {} };
  await recorrerPublicacionesConPromos(
    empresaId,
    seleccion,
    async ({ activas }) => {
      vista.publicaciones += 1;
      for (const promo of activas) {
        const tipo = tipoDe(promo);
        vista.promociones += 1;
        vista.porTipo[tipo] = (vista.porTipo[tipo] ?? 0) + 1;
        if (puedeSalirPorApi(tipo)) vista.salibles += 1;
        else vista.noPermitidas += 1;
      }
    },
    (r) => {
      if (r === "leida") vista.revisadas += 1;
      else vista.lecturasConError += 1;
    }
  );
  return vista;
}

export type EstadoFilaSalirTodas = "salio" | "error" | "no_permitida";

export type FilaSalirTodas = {
  itemId: string;
  cuentaMlId: string;
  tituloProducto: string | null;
  tipoPromocion: string;
  estado: EstadoFilaSalirTodas;
  error: string | null;
};

export type ResumenSalirTodas = { revisadas: number; salieron: number; errores: number; noPermitidas: number; filas: FilaSalirTodas[] };

export async function salirDeTodasLasPromociones(empresaId: string, usuarioId: string, seleccion: ItemSeleccionado[]): Promise<ResumenSalirTodas> {
  const resumen: ResumenSalirTodas = { revisadas: 0, salieron: 0, errores: 0, noPermitidas: 0, filas: [] };
  // Promo-E: todas las filas de esta ejecución comparten el mismo lote.
  const lote = nuevoLoteBitacora();

  await recorrerPublicacionesConPromos(
    empresaId,
    seleccion,
    async ({ cuenta, token, itemId, activas }) => {
      let titulo: string | null = null;
      try {
        titulo = (await conReintento429Lectura(() => leerItemParaPromocionMl(itemId, token)))?.title ?? null;
      } catch {
        titulo = null; // el título es solo para mostrar; nunca frena la salida
      }

      // Secuencial DENTRO del ítem (ML puede responder 423 si dos
      // operaciones tocan el mismo ítem a la vez); el paralelismo vive
      // entre ítems, con el mismo tope bajo que «Aplicar regla».
      for (const promo of activas) {
        const tipo = tipoDe(promo);
        const base = { itemId, cuentaMlId: cuenta.id, tituloProducto: titulo, tipoPromocion: tipo };

        if (!puedeSalirPorApi(tipo)) {
          const motivoNoApi = "No se puede salir por API, hay que hacerlo en la Central de Promociones de Mercado Libre.";
          resumen.noPermitidas += 1;
          resumen.filas.push({ ...base, estado: "no_permitida", error: motivoNoApi });
          // Nunca se llama a Mercado Libre: queda «rechazada» con el motivo (100 = 100).
          try {
            await dbComoEmpresa(empresaId, (tx) =>
              tx.insert(promocionesAcciones).values({
                empresaId,
                cuentaMlId: cuenta.id,
                itemId,
                tituloProducto: titulo,
                tipoPromocion: tipo,
                promotionIdMl: typeof promo.id === "string" ? promo.id : null,
                accion: "salir",
                precioAntes: typeof promo.price === "number" ? String(promo.price) : null,
                precioDespues: null,
                estado: "rechazada",
                aprobadoPor: usuarioId,
                aprobadoTs: new Date(),
                ejecutadoPor: usuarioId,
                ejecutadoTs: new Date(),
                modoSimulacion: false,
                resultadoMl: resultadoMlOmitida("salir", "salir-todas", motivoNoApi, { lote, limite: "ml", nombrePromocion: typeof promo.name === "string" ? promo.name : null }),
                error: motivoNoApi,
              })
            );
          } catch {
            /* la bitácora nunca frena la salida */
          }
          continue;
        }

        const promotionId = typeof promo.id === "string" ? promo.id : "";
        let respuesta;
        try {
          respuesta = await salirDePromocionConReintento(itemId, token, promotionId, tipo);
        } catch (error) {
          resumen.errores += 1;
          resumen.filas.push({ ...base, estado: "error", error: error instanceof Error ? error.message.slice(0, 400) : "No se pudo salir de la promoción." });
          continue;
        }

        if ("bloqueadoPorLimite" in respuesta) {
          // Igual que la salida individual: nunca se adivina si el DELETE
          // pasó, así que no queda en la auditoría como "fallida".
          resumen.errores += 1;
          resumen.filas.push({ ...base, estado: "error", error: respuesta.mensaje });
          continue;
        }

        const motivo = respuesta.ok
          ? null
          : respuesta.status === 423
            ? "Mercado Libre bloqueó este producto por un momento (otra operación en curso) — probar de nuevo en unos segundos."
            : `Mercado Libre respondió HTTP ${respuesta.status}: ${motivoErrorEscrituraMl(respuesta.textoCrudo) ?? respuesta.textoCrudo.slice(0, 400)}`;

        // Mismo formato de auditoría que la salida individual
        // (app/api/ml/promociones/participando/salir/route.ts).
        const precioAntes = typeof promo.price === "number" ? promo.price : null;
        await dbComoEmpresa(empresaId, (tx) =>
          tx.insert(promocionesAcciones).values({
            empresaId,
            cuentaMlId: cuenta.id,
            itemId,
            tituloProducto: titulo,
            tipoPromocion: tipo,
            promotionIdMl: promotionId || null,
            accion: "salir",
            precioAntes: precioAntes != null ? String(precioAntes) : null,
            precioDespues: null,
            estado: respuesta.ok ? "ejecutada" : "fallida",
            aprobadoPor: usuarioId,
            aprobadoTs: new Date(),
            ejecutadoPor: usuarioId,
            ejecutadoTs: new Date(),
            modoSimulacion: false,
            resultadoMl: conReglaYOrigen({ ok: respuesta.ok, status: respuesta.status, masivo: true }, "salir", "salir-todas", { lote, limite: "ninguno", nombrePromocion: typeof promo.name === "string" ? promo.name : null }),
            error: motivo,
          })
        );

        if (respuesta.ok) {
          resumen.salieron += 1;
          resumen.filas.push({ ...base, estado: "salio", error: null });
        } else {
          resumen.errores += 1;
          resumen.filas.push({ ...base, estado: "error", error: motivo });
        }
      }
    },
    (r) => {
      if (r === "leida") resumen.revisadas += 1;
    }
  );

  return resumen;
}
