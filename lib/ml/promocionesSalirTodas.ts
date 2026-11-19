import { dbComoEmpresa } from "@/db/empresa-context";
import { promocionesAcciones } from "@/db/schema";
import { conConcurrenciaLimitada } from "@/lib/concurrencia";
import { leerItemParaPromocionMl, leerPromocionesItemMl, listarItemsActivosMl, motivoErrorEscrituraMl, type PromocionCrudaMl } from "@/lib/ml/cliente";
import { obtenerAccessTokenVigente } from "@/lib/ml/cuentas";
import { puedeSalirPorApi } from "@/lib/ml/promociones";
import { conReintento429Lectura, listarCuentasParaPublicaciones, TAMANO_LOTE_ML, TOPE_CONCURRENCIA_APLICAR_REGLA } from "@/lib/ml/promocionesPublicaciones";
import { salirDePromocionConReintento } from "@/lib/ml/promocionesSalir";

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

// Recorre el catálogo activo de las cuentas pedidas, página por página
// (nunca todo de una vez), y le entrega a `porItem` cada publicación
// junto con sus promociones activas. Lo comparten la vista previa y la
// ejecución — la misma lectura, así lo que se cuenta es lo que se hace.
async function recorrerPublicacionesConPromos(
  empresaId: string,
  cuentaId: string | "todas",
  porItem: (ctx: { cuenta: { id: string; nickname: string }; token: string; itemId: string; activas: PromocionCrudaMl[] }) => Promise<void>,
  alLeer: (resultado: "leida" | "error") => void
): Promise<void> {
  const cuentas = await listarCuentasParaPublicaciones(empresaId, cuentaId);
  for (const cuenta of cuentas) {
    let token: string;
    try {
      token = await obtenerAccessTokenVigente(empresaId, cuenta.id);
    } catch {
      continue; // una cuenta sin token válido nunca frena a las demás
    }
    let offset = 0;
    while (true) {
      const pagina = await conReintento429Lectura(() => listarItemsActivosMl(cuenta.cuentaIdExterna, token, offset, TAMANO_LOTE_ML));
      if (pagina.ids.length === 0) break;

      await conConcurrenciaLimitada(pagina.ids, TOPE_CONCURRENCIA_APLICAR_REGLA, async (itemId) => {
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

      offset += pagina.ids.length;
      if (pagina.ids.length < TAMANO_LOTE_ML || offset >= pagina.totalCatalogo) break;
    }
  }
}

export async function vistaPreviaSalirTodas(empresaId: string, cuentaId: string | "todas"): Promise<VistaPreviaSalirTodas> {
  const vista: VistaPreviaSalirTodas = { revisadas: 0, publicaciones: 0, promociones: 0, salibles: 0, noPermitidas: 0, lecturasConError: 0, porTipo: {} };
  await recorrerPublicacionesConPromos(
    empresaId,
    cuentaId,
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

export async function salirDeTodasLasPromociones(empresaId: string, usuarioId: string, cuentaId: string | "todas"): Promise<ResumenSalirTodas> {
  const resumen: ResumenSalirTodas = { revisadas: 0, salieron: 0, errores: 0, noPermitidas: 0, filas: [] };

  await recorrerPublicacionesConPromos(
    empresaId,
    cuentaId,
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
          resumen.noPermitidas += 1;
          resumen.filas.push({ ...base, estado: "no_permitida", error: "No se puede salir por API, hay que hacerlo en la Central de Promociones de Mercado Libre." });
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
            resultadoMl: { ok: respuesta.ok, status: respuesta.status, masivo: true },
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
