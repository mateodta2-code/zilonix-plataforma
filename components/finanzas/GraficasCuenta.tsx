import Link from "next/link";
import { aCentavos } from "@/lib/finanzas/utilidad-venta";
import { MONEDA_PUBLICIDAD, participacion, type FilaCuentaTablero, type PublicidadMes } from "@/lib/finanzas/tablero";
import { formatearMonto } from "@/lib/panel-kpis";
import { EstadoVacio } from "@/components/marco/EstadoVacio";
import { CeldaTabla, FilaTabla, Tabla } from "@/components/marco/Tabla";
import { montosPorMoneda } from "./textosTablero";
import styles from "./inicio.module.css";

// Issue #143 — gráficas por cuenta de Inicio (participación, publicidad
// y comparativo), para cualquier período. En SVG y CSS, sin librería;
// colores de tokens existentes (.serie0 … .serie5 en inicio.module.css).

const SERIES = 6;

function serie(i: number): string {
  return styles[`serie${i % SERIES}`];
}

// Torta de anillo: cada cuenta es un arco de un círculo de perímetro 100
// (r = 15,9155), así el largo del trazo es directamente el porcentaje.
// Number solo para la geometría del dibujo; el % de la leyenda sale de
// participacion() (texto, 1 decimal).
export function Participacion({ filas }: { filas: FilaCuentaTablero[] }) {
  const conVentas = filas.filter((f) => f.ventas > 0).sort((a, b) => b.ventas - a.ventas || a.nickname.localeCompare(b.nickname));
  const total = conVentas.reduce((s, f) => s + f.ventas, 0);
  if (total === 0) return <EstadoVacio>No hay ventas en este período.</EstadoVacio>;
  let acumulado = 0;
  return (
    <div className={styles.participacion}>
      <svg viewBox="0 0 42 42" className={styles.dona} role="img" aria-label="Participación de cada cuenta en las ventas del período">
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
export function InversionPublicidad({ publicidad }: { publicidad: PublicidadMes }) {
  const conGasto = publicidad.porCuenta.filter((c) => aCentavos(c.monto) > BigInt(0));
  if (publicidad.totalPorMoneda === null || conGasto.length === 0) {
    return (
      <EstadoVacio>
        No hay publicidad sincronizada en este período · actualiza en{" "}
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

export function Comparativo({ filas }: { filas: FilaCuentaTablero[] }) {
  if (filas.length === 0) return <EstadoVacio>No hay ventas ni publicidad en este período.</EstadoVacio>;
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
