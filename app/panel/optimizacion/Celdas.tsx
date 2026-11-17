import { Suspense, type ReactNode } from "react";
import { formatearMoneda, formatearNumero } from "@/lib/ml/sitios";
import { calcularConversion, formatearConversion, precioConPromocion } from "@/lib/ml/optimizacion";
import type { CalidadItem, CompetenciaItem } from "@/lib/ml/optimizacion";
import type { PrecioPromocionMl } from "@/lib/ml/cliente";
import type { MapaMetrica } from "@/lib/ml/optimizacion-datos";
import styles from "./page.module.css";

// Celdas de métricas: componentes de servidor que esperan su promesa
// dentro de <Suspense>. La fila ya salió con la lista base; cada celda se
// llena cuando su métrica llega, y si falla muestra "No disponible".

const NO_DISPONIBLE = <span className={styles.nodisp}>No disponible</span>;
const CARGANDO = <span className={styles.cargando}>…</span>;

type Sitio = { siteId: string; idioma: string };

function Esperando({ children }: { children: ReactNode }) {
  return <Suspense fallback={CARGANDO}>{children}</Suspense>;
}

async function CeldaPrecio({ promesa, itemId, precioBase, sitio }: { promesa: Promise<MapaMetrica<PrecioPromocionMl>>; itemId: string; precioBase: number | null; sitio: Sitio }) {
  const promo = precioConPromocion((await promesa).get(itemId) ?? null);
  if (promo) {
    return (
      <>
        {formatearMoneda(promo.vigente, sitio.siteId)}
        <span className={styles.tachado}>{formatearMoneda(promo.regular, sitio.siteId)}</span>
      </>
    );
  }
  return precioBase == null ? NO_DISPONIBLE : <>{formatearMoneda(precioBase, sitio.siteId)}</>;
}

export function CeldaPrecioAsync(props: { promesa: Promise<MapaMetrica<PrecioPromocionMl>>; itemId: string; precioBase: number | null; sitio: Sitio }) {
  return (
    <Suspense fallback={props.precioBase == null ? CARGANDO : <>{formatearMoneda(props.precioBase, props.sitio.siteId)}</>}>
      <CeldaPrecio {...props} />
    </Suspense>
  );
}

async function CeldaVisitas({ promesa, itemId, sitio }: { promesa: Promise<MapaMetrica<number>>; itemId: string; sitio: Sitio }) {
  const visitas = (await promesa).get(itemId) ?? null;
  return visitas == null ? NO_DISPONIBLE : <>{formatearNumero(visitas, sitio.idioma)}</>;
}

export function CeldaVisitasAsync(props: { promesa: Promise<MapaMetrica<number>>; itemId: string; sitio: Sitio }) {
  return (
    <Esperando>
      <CeldaVisitas {...props} />
    </Esperando>
  );
}

async function CeldaVentas({ promesa, itemId, sitio }: { promesa: Promise<Record<string, number> | null>; itemId: string; sitio: Sitio }) {
  const ventas = await promesa;
  // Un ítem que no aparece en las ventas de la ventana vendió 0.
  return ventas == null ? NO_DISPONIBLE : <>{formatearNumero(ventas[itemId] ?? 0, sitio.idioma)}</>;
}

export function CeldaVentasAsync(props: { promesa: Promise<Record<string, number> | null>; itemId: string; sitio: Sitio }) {
  return (
    <Esperando>
      <CeldaVentas {...props} />
    </Esperando>
  );
}

async function CeldaConversion({ visitasP, ventasP, itemId, sitio }: { visitasP: Promise<MapaMetrica<number>>; ventasP: Promise<Record<string, number> | null>; itemId: string; sitio: Sitio }) {
  const [visitas, ventas] = await Promise.all([visitasP, ventasP]);
  const v = visitas.get(itemId) ?? null;
  if (v == null || ventas == null) return NO_DISPONIBLE;
  return <>{formatearConversion(calcularConversion(ventas[itemId] ?? 0, v), (n) => formatearNumero(n, sitio.idioma))}</>;
}

export function CeldaConversionAsync(props: { visitasP: Promise<MapaMetrica<number>>; ventasP: Promise<Record<string, number> | null>; itemId: string; sitio: Sitio }) {
  return (
    <Esperando>
      <CeldaConversion {...props} />
    </Esperando>
  );
}

async function CeldaCalidad({ promesa, itemId }: { promesa: Promise<MapaMetrica<CalidadItem>>; itemId: string }) {
  const calidad = (await promesa).get(itemId) ?? null;
  if (!calidad) return NO_DISPONIBLE;
  const n = calidad.objetivosPendientes.length;
  const lista = n > 0 ? calidad.objetivosPendientes.map((t) => `• ${t}`).join("\n") : "Sin objetivos pendientes";
  return (
    <span title={lista}>
      {calidad.score != null ? calidad.score : "—"}
      {calidad.nivel ? ` · ${calidad.nivel}` : ""}
      <span className={styles.meta}> · {n === 1 ? "1 objetivo" : `${n} objetivos`}</span>
    </span>
  );
}

export function CeldaCalidadAsync(props: { promesa: Promise<MapaMetrica<CalidadItem>>; itemId: string }) {
  return (
    <Esperando>
      <CeldaCalidad {...props} />
    </Esperando>
  );
}

async function CeldaCompetencia({ promesa, itemId }: { promesa: Promise<MapaMetrica<CompetenciaItem>>; itemId: string }) {
  const c = (await promesa).get(itemId) ?? null;
  if (!c) return NO_DISPONIBLE;
  return (
    <>
      {c.texto}
      {c.detalle ? <span className={styles.meta}> ({c.detalle})</span> : null}
    </>
  );
}

export function CeldaCompetenciaAsync(props: { promesa: Promise<MapaMetrica<CompetenciaItem>>; itemId: string }) {
  return (
    <Esperando>
      <CeldaCompetencia {...props} />
    </Esperando>
  );
}
