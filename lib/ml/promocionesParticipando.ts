import { and, eq, inArray } from "drizzle-orm";
import { dbComoEmpresa } from "@/db/empresa-context";
import { promocionesCandidatos } from "@/db/schema";
import { obtenerAccessTokenVigente } from "@/lib/ml/cuentas";
import { leerPromocionesItemMl, type PromocionCrudaMl } from "@/lib/ml/cliente";
import { calcularCandidatosItem, fechasParaParticipar, leerPisoYCostoFresco, leerReglasFrescasCuenta, puedeSalirPorApi, type ItemConPromociones } from "@/lib/ml/promociones";

// Rama fix-promociones-aprobadas-participando, punto 3 — "Participando":
// lista las promociones donde la cuenta YA participa en Mercado Libre
// (estado started/pending), con un botón para "Dejar de participar".
//
// Diseño elegido para no necesitar ninguna migración: "Buscar"
// (lib/trabajos/buscarPromocionesMultiCuenta.ts) ya recorre TODO el
// catálogo y guarda cada promoción que encuentra en
// promociones_candidatos, started/pending incluidas (calcularCandidatosItem,
// punto 4 de ese switch, ya las procesa) — ESE snapshot es la lista de
// "qué ítems/tipos chequear" acá. Nunca se escanea el catálogo de
// nuevo: eso ya lo hace Buscar, y duplicarlo en cada apertura de esta
// pestaña sería carísimo. Lo que SÍ se hace fresco, en vivo, por cada
// ítem de esa lista (siempre un conjunto chico — solo lo que ya está
// activo, nunca el catálogo completo): volver a leer el estado real en
// Mercado Libre (nunca se confía en el snapshot para esto, puede ser
// de hace horas) para las fechas reales (que el snapshot nunca guarda
// — "gap real" documentado desde el PR #307, sin migración) y para no
// mostrar algo que la cuenta ya dejó por otro lado (ej. desde la app
// de Mercado Libre) entre la última búsqueda y ahora.
//
// Limitación real, documentada a propósito: si una cuenta se unió a
// una promoción nueva después de la última vez que corrió "Buscar"
// para ella, esa promoción no aparece acá hasta la próxima búsqueda —
// esta pestaña nunca inventa un escaneo nuevo por su cuenta.
const ESTADOS_PARTICIPANDO = ["started", "pending"];

export type FilaParticipando = {
  cuentaMlId: string;
  itemId: string;
  skuCodigo: string | null;
  tituloProducto: string | null;
  thumbnail: string | null;
  tipoPromocion: string;
  promotionIdMl: string | null;
  estadoMl: string;
  precioOriginal: number | null;
  precioActual: number | null;
  precioMinimo: number | null;
  maxDiscountedPrice: number | null;
  gananciaEstimada: number | null;
  cumpleReglas: boolean;
  fechaInicio: string;
  fechaFin: string;
  // Punto 3 — investigado contra la doc oficial de ML
  // (TIPOS_SALIR_API, lib/ml/promociones.ts). false = "Solo desde ML".
  puedeSalirApi: boolean;
};

type CandidatoDescubierto = {
  itemId: string;
  skuCodigo: string | null;
  tituloProducto: string | null;
  thumbnail: string | null;
  tipoPromocion: string;
  promotionIdMl: string | null;
};

async function descubrirCandidatosParticipando(empresaId: string, cuentaMlId: string): Promise<CandidatoDescubierto[]> {
  return dbComoEmpresa(empresaId, (tx) =>
    tx
      .select({
        itemId: promocionesCandidatos.itemId,
        skuCodigo: promocionesCandidatos.skuCodigo,
        tituloProducto: promocionesCandidatos.tituloProducto,
        thumbnail: promocionesCandidatos.thumbnail,
        tipoPromocion: promocionesCandidatos.tipoPromocion,
        promotionIdMl: promocionesCandidatos.promotionIdMl,
      })
      .from(promocionesCandidatos)
      .where(
        and(
          eq(promocionesCandidatos.empresaId, empresaId),
          eq(promocionesCandidatos.cuentaMlId, cuentaMlId),
          inArray(promocionesCandidatos.estadoMl, ESTADOS_PARTICIPANDO)
        )
      )
  );
}

// Entre todas las promociones reales que trae el ítem, la que
// corresponde a este candidato puntual — por promotionIdMl cuando el
// snapshot lo tiene (identificador real, nunca ambiguo); si no (datos
// viejos de antes de guardar promotionIdMl), cae a tipo+estado
// started/pending, igual que hace el motor cuando arma el candidato la
// primera vez.
function promoQueCorresponde(promos: PromocionCrudaMl[], candidato: CandidatoDescubierto): PromocionCrudaMl | null {
  if (candidato.promotionIdMl) {
    const porId = promos.find((p) => p.id === candidato.promotionIdMl);
    if (porId) return porId;
  }
  return (
    promos.find((p) => p.type === candidato.tipoPromocion && (p.status === "started" || p.status === "pending")) ?? null
  );
}

export async function listarParticipandoCuenta(empresaId: string, cuentaMlId: string): Promise<FilaParticipando[]> {
  const descubiertos = await descubrirCandidatosParticipando(empresaId, cuentaMlId);
  if (descubiertos.length === 0) return [];

  const [token, reglas] = await Promise.all([obtenerAccessTokenVigente(empresaId, cuentaMlId), leerReglasFrescasCuenta(empresaId, cuentaMlId)]);

  const filas: FilaParticipando[] = [];
  for (const candidato of descubiertos) {
    const resultado = await leerPromocionesItemMl(candidato.itemId, token);
    if (resultado.estado !== "ok") continue; // ítem con error puntual (403/401/5xx) — se omite, nunca rompe el resto

    const promo = promoQueCorresponde(resultado.promociones, candidato);
    if (!promo) continue; // ya no está started/pending (la cuenta salió desde otro lado, o cambió) — nunca se muestra como "participando" algo que ya no lo es

    const { precioMinimo, costo } = await leerPisoYCostoFresco(empresaId, candidato.skuCodigo);

    const item: ItemConPromociones = {
      itemId: candidato.itemId,
      cuentaMlId,
      nickname: "",
      tituloProducto: candidato.tituloProducto,
      thumbnail: candidato.thumbnail,
      skuCodigo: candidato.skuCodigo,
      tieneVariantes: false,
      skuVariantesDistintas: false,
      promociones: [promo],
    };
    const [calculado] = calcularCandidatosItem(item, reglas, precioMinimo, costo);
    const { fechaInicio, fechaFin } = fechasParaParticipar(promo);

    filas.push({
      cuentaMlId,
      itemId: candidato.itemId,
      skuCodigo: candidato.skuCodigo,
      tituloProducto: candidato.tituloProducto,
      thumbnail: candidato.thumbnail,
      tipoPromocion: calculado.tipoPromocion,
      promotionIdMl: calculado.promotionIdMl,
      estadoMl: calculado.estadoMl,
      precioOriginal: calculado.precioOriginal,
      precioActual: calculado.precioActual,
      precioMinimo: calculado.precioMinimo,
      maxDiscountedPrice: calculado.maxDiscountedPrice,
      gananciaEstimada: calculado.gananciaEstimada,
      cumpleReglas: calculado.cumpleReglas,
      fechaInicio,
      fechaFin,
      puedeSalirApi: puedeSalirPorApi(calculado.tipoPromocion),
    });
  }
  return filas;
}
