import { RejillaKpi } from "@/components/marco/RejillaKpi";
import { TarjetaKpi } from "@/components/marco/TarjetaKpi";
import { formatearMoneda } from "@/lib/ml/sitios";
import { variacion } from "@/lib/optimizacion/calculos";
import type { DatosResumenTienda } from "@/lib/optimizacion/resumenTiendaDatos";
import styles from "./page.module.css";

// Resumen global de la tienda (la cuenta elegida), como el «Resumen de
// desempeño» de Métricas de negocio de Mercado Libre, con el período de
// arriba (7, 14, 30 o 90 días) contra el anterior. Los montos solo se
// muestran a quien puede ver ventas.
export function ResumenTienda({
  datos,
  dias,
  siteId,
  idioma,
  verMontos,
}: {
  datos: DatosResumenTienda;
  dias: number;
  siteId: string;
  idioma: string;
  verMontos: boolean;
}) {
  const { actual, anterior } = datos;
  const plata = (v: string | null) => (v === null ? "—" : formatearMoneda(Number(v), siteId));
  const num = (v: number | null) => (v === null ? "—" : v.toLocaleString(idioma));
  const pct = (v: string | null) => (v === null ? "—" : `${Number(v).toLocaleString(idioma, { maximumFractionDigits: 1 })} %`);
  // `masEsMejor` false: subir es malo (canceladas, devueltas).
  const cambio = (a: string | number | null, b: string | number | null, masEsMejor = true) => {
    const v = variacion(a, b);
    if (v === null) return undefined;
    const n = Number(v);
    return {
      texto: `${n > 0 ? "▲ " : n < 0 ? "▼ " : ""}${Math.abs(n).toLocaleString(idioma, { maximumFractionDigits: 1 })} % vs. ${dias} días anteriores`,
      mejor: n === 0 ? null : n > 0 === masEsMejor,
    };
  };
  // Conversión: la diferencia en puntos, como Mercado Libre.
  const cambioConversion = () => {
    if (actual.conversion === null || anterior.conversion === null) return undefined;
    const d = Number(actual.conversion) - Number(anterior.conversion);
    return {
      texto: `${d > 0 ? "▲ " : d < 0 ? "▼ " : ""}${Math.abs(d).toLocaleString(idioma, { maximumFractionDigits: 1 })} puntos vs. ${dias} días anteriores`,
      mejor: d === 0 ? null : d > 0,
    };
  };

  return (
    <section className={styles.resumenTienda} aria-label="Resumen de la tienda">
      <div className={styles.barra}>
        <p className={styles.seccion}>Resumen de la tienda · últimos {dias} días</p>
        <span className={styles.notaNeutra}>
          Del {datos.periodo.desde} al {datos.periodo.hasta}. Ventas de lo que Seller ya sincronizó; visitas de Mercado Libre.
        </span>
      </div>
      <RejillaKpi>
        {verMontos ? <TarjetaKpi titulo="Ventas brutas" valor={plata(actual.ventasBrutas)} variacion={cambio(actual.ventasBrutas, anterior.ventasBrutas)} /> : null}
        <TarjetaKpi
          titulo="Unidades vendidas"
          valor={num(actual.unidades)}
          variacion={cambio(actual.unidades, anterior.unidades)}
          detalle={actual.unidadesCompletas ? undefined : ["Faltan ventas por sincronizar en Finanzas."]}
        />
        {verMontos ? <TarjetaKpi titulo="Precio promedio por unidad" valor={plata(actual.precioPorUnidad)} variacion={cambio(actual.precioPorUnidad, anterior.precioPorUnidad)} /> : null}
        <TarjetaKpi
          titulo="Visitas"
          valor={actual.visitas === null ? undefined : num(actual.visitas)}
          textoVacio="Mercado Libre no las devolvió"
          variacion={cambio(actual.visitas, anterior.visitas)}
        />
        <TarjetaKpi titulo="Cantidad de ventas" valor={num(actual.ventas)} variacion={cambio(actual.ventas, anterior.ventas)} />
        <TarjetaKpi titulo="Conversión" valor={pct(actual.conversion)} variacion={cambioConversion()} detalle={["Ventas ÷ visitas."]} />
        {verMontos ? <TarjetaKpi titulo="Precio promedio por venta" valor={plata(actual.precioPorVenta)} variacion={cambio(actual.precioPorVenta, anterior.precioPorVenta)} /> : null}
        <TarjetaKpi titulo="Ventas canceladas" valor={num(actual.canceladas)} variacion={cambio(actual.canceladas, anterior.canceladas, false)} detalle={verMontos ? [plata(actual.valorCanceladas)] : undefined} />
        <TarjetaKpi
          titulo="Ventas devueltas"
          valor={num(actual.devueltas)}
          variacion={cambio(actual.devueltas, anterior.devueltas, false)}
          detalle={verMontos ? [`${plata(actual.valorDevueltas)} reembolsados`] : undefined}
        />
      </RejillaKpi>
    </section>
  );
}
