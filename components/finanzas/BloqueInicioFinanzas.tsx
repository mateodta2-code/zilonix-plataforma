import Link from "next/link";
import { aCentavos } from "@/lib/finanzas/utilidad-venta";
import {
  MONEDA_PUBLICIDAD,
  participacion,
  textoVariacion,
  type FilaCuentaTablero,
  type PublicidadMes,
  type TableroMes,
  type UtilidadMes,
} from "@/lib/finanzas/tablero";
import { formatearMonto } from "@/lib/panel-kpis";
import { EstadoVacio } from "@/components/marco/EstadoVacio";
import { CeldaTabla, FilaTabla, Tabla } from "@/components/marco/Tabla";
import { Tarjeta } from "@/components/marco/Tarjeta";
import { TarjetaKpi } from "@/components/marco/TarjetaKpi";
import {
  avisoFaltanVentas,
  detalleUtilidadMes,
  montosPorMoneda,
  porMoneda,
  valorUtilidad,
  variacionesPorMoneda,
} from "./textosTablero";
import styles from "./inicio.module.css";

// Issue #143 — bloque de Finanzas de Inicio, con las piezas del tablero
// de Zilonix OS que Sharel pegó el 29-oct: KPIs del mes, participación
// por cuenta, comparativo por cuenta y publicidad por cuenta. Solo pinta
// lo que ya leyó app/panel/page.tsx (y solo si el rol tiene
// finanzas.consultar; si no, este componente ni se monta).
//
// La tarjeta de cantidad dice «Cantidad de ventas del mes» para no
// confundirse con «Ventas del mes» (en plata) de arriba (Sharel, review
// de #306). La de hoy no va: repetía «Ventas de hoy» de arriba (smoke
// del 30-oct). Gráficas en SVG y CSS, sin librería; colores de tokens
// existentes.

type Props = {
  tablero: TableroMes;
  utilidad: UtilidadMes;
  porCuenta: FilaCuentaTablero[];
  publicidad: PublicidadMes;
};

// Paleta de las series: tokens de marca de app/globals.css (plateado y
// azul), en ciclo. Ver .serie0 … .serie5 en inicio.module.css.
const SERIES = 6;

function serie(i: number): string {
  return styles[`serie${i % SERIES}`];
}

export function BloqueInicioFinanzas({ tablero, utilidad, porCuenta, publicidad }: Props) {
  const avisoFaltan = avisoFaltanVentas(tablero);
  const totalPublicidad = publicidad.totalPorMoneda;
  return (
    <section className={styles.bloque} aria-labelledby="titulo-finanzas-inicio">
      {/* En una <Tarjeta> (zona oscura en los dos temas): en claro el fondo
          de la página cambia de oscuro a blanco y un texto suelto quedaría
          ilegible en algún tramo. */}
      <Tarjeta className={styles.encabezado}>
        <h2 id="titulo-finanzas-inicio" className={styles.titulo}>
          Indicadores de Finanzas del mes{" "}
          <span className={styles.rango}>
            ({tablero.tramo.desde} a {tablero.tramo.hasta})
          </span>
        </h2>
        <p className={styles.ayuda}>Igual que en Finanzas · utilidad antes de publicidad · todas las cuentas ML de esta empresa.</p>
      </Tarjeta>

      <div className={styles.gridKpi}>
        <TarjetaKpi titulo="Cantidad de ventas del mes" valor={String(tablero.ventas.actual)} detalle={[textoVariacion(tablero.ventas.variacion)]} />
        <TarjetaKpi
          titulo="Recaudo del mes"
          valor={porMoneda(tablero, "actual")}
          detalle={[...variacionesPorMoneda(tablero, "variacion"), ...avisoFaltan]}
        />
        <TarjetaKpi
          titulo="Recaudo promedio diario"
          valor={porMoneda(tablero, "promedioActual")}
          detalle={[...variacionesPorMoneda(tablero, "variacionPromedio"), `Recaudo del mes ÷ ${tablero.tramo.dias} ${tablero.tramo.dias === 1 ? "día" : "días"}.`]}
        />
        <TarjetaKpi titulo="Utilidad del mes (antes de publicidad)" valor={valorUtilidad(tablero, utilidad)} detalle={detalleUtilidadMes(tablero, utilidad)} />
        <TarjetaKpi
          titulo="Publicidad invertida"
          valor={totalPublicidad ? montosPorMoneda(totalPublicidad) : "Sin datos"}
          detalle={[totalPublicidad ? "Costo de Product Ads del mes, todas las cuentas." : "Todavía no hay publicidad sincronizada este mes."]}
        />
      </div>

      <div className={styles.gridGraficas}>
        <Tarjeta className={styles.panel}>
          <h3 className={styles.subtitulo}>Participación por cuenta (ventas)</h3>
          <Participacion filas={porCuenta} />
        </Tarjeta>
        <Tarjeta className={styles.panel}>
          <h3 className={styles.subtitulo}>
            Publicidad · inversión por cuenta
            {totalPublicidad && <span className={styles.rango}> · total {montosPorMoneda(totalPublicidad)}</span>}
          </h3>
          <InversionPublicidad publicidad={publicidad} />
        </Tarjeta>
      </div>

      <Tarjeta className={styles.panel}>
        <h3 className={styles.subtitulo}>Comparativo por cuenta (equipo)</h3>
        <Comparativo filas={porCuenta} />
      </Tarjeta>

      <Link href="/panel/finanzas" className={styles.enlace}>
        Ver tablero completo en Finanzas →
      </Link>
    </section>
  );
}

// Torta de anillo: cada cuenta es un arco de un círculo de perímetro 100
// (r = 15,9155), así el largo del trazo es directamente el porcentaje.
// Number solo para la geometría del dibujo; el % de la leyenda sale de
// participacion() (texto, 1 decimal).
function Participacion({ filas }: { filas: FilaCuentaTablero[] }) {
  const conVentas = filas.filter((f) => f.ventas > 0).sort((a, b) => b.ventas - a.ventas || a.nickname.localeCompare(b.nickname));
  const total = conVentas.reduce((s, f) => s + f.ventas, 0);
  if (total === 0) return <EstadoVacio>Todavía no hay ventas este mes.</EstadoVacio>;
  let acumulado = 0;
  return (
    <div className={styles.participacion}>
      <svg viewBox="0 0 42 42" className={styles.dona} role="img" aria-label="Participación de cada cuenta en las ventas del mes">
        <circle cx="21" cy="21" r="15.9155" className={styles.donaFondo} />
        {conVentas.map((f, i) => {
          const largo = (f.ventas / total) * 100;
          const arco = (
            <circle
              key={f.cuentaMlId}
              cx="21"
              cy="21"
              r="15.9155"
              className={`${styles.donaArco} ${serie(i)}`}
              strokeDasharray={`${largo} ${100 - largo}`}
              strokeDashoffset={25 - acumulado}
            />
          );
          acumulado += largo;
          return arco;
        })}
        <text x="21" y="21" className={styles.donaTotal}>
          {total}
        </text>
        <text x="21" y="26" className={styles.donaEtiqueta}>
          ventas
        </text>
      </svg>
      <ul className={styles.leyenda}>
        {conVentas.map((f, i) => (
          <li key={f.cuentaMlId}>
            <span className={`${styles.muestra} ${serie(i)}`} aria-hidden="true" />
            <span className={styles.leyendaNombre}>{f.nickname}</span>
            <span className={styles.numero}>
              {f.ventas} · {participacion(f.ventas, total).replace(".", ",")} %
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

// Barras horizontales: ancho relativo al mayor gasto (centavos BigInt,
// en décimas de %).
function InversionPublicidad({ publicidad }: { publicidad: PublicidadMes }) {
  const conGasto = publicidad.porCuenta.filter((c) => aCentavos(c.monto) > BigInt(0));
  if (publicidad.totalPorMoneda === null || conGasto.length === 0) {
    return (
      <EstadoVacio>
        Todavía no hay publicidad sincronizada este mes · actualiza en{" "}
        <Link href="/panel/publicidad" className={styles.enlace}>
          Publicidad
        </Link>
        .
      </EstadoVacio>
    );
  }
  const maximo = aCentavos(conGasto[0].monto);
  return (
    <ul className={styles.barras}>
      {conGasto.map((c, i) => {
        const decimas = (aCentavos(c.monto) * BigInt(1000)) / maximo;
        return (
          <li key={c.cuentaMlId} className={styles.barraFila}>
            <span className={styles.leyendaNombre}>{c.nickname}</span>
            <span className={styles.barraPista}>
              <span className={`${styles.barra} ${serie(i)}`} style={{ width: `${decimas / BigInt(10)}.${decimas % BigInt(10)}%` }} />
            </span>
            <span className={styles.numero}>
              {c.moneda} {formatearMonto(c.monto)}
            </span>
          </li>
        );
      })}
    </ul>
  );
}

function Comparativo({ filas }: { filas: FilaCuentaTablero[] }) {
  if (filas.length === 0) return <EstadoVacio>Todavía no hay ventas ni publicidad este mes.</EstadoVacio>;
  return (
    <div className={styles.tablaComparativo}>
      <Tabla encabezados={["Cuenta", "Ventas", "Recaudo", "Publicidad"]}>
        {filas.map((f) => (
          <FilaTabla key={f.cuentaMlId}>
            <CeldaTabla>
              <strong>{f.nickname}</strong>
            </CeldaTabla>
            <CeldaTabla className={styles.numero}>{f.ventas}</CeldaTabla>
            <CeldaTabla className={styles.numero}>{montosPorMoneda(f.recaudoPorMoneda)}</CeldaTabla>
            <CeldaTabla className={styles.numero}>{f.publicidad === null ? "—" : `${MONEDA_PUBLICIDAD} ${formatearMonto(f.publicidad)}`}</CeldaTabla>
          </FilaTabla>
        ))}
      </Tabla>
    </div>
  );
}
