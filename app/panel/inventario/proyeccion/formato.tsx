import { Chip, type EstadoChip } from "@/components/marco/Chip";
import { ETIQUETA_ESTADO, type EstadoProyeccion, type ResultadoProyeccion } from "@/lib/inventario/proyeccion";
import styles from "./proyeccion.module.css";

// Proyección de inventarios — pedazos de pantalla que repiten las vistas.

const ESTADO_CHIP: Record<EstadoProyeccion, EstadoChip> = {
  comprar_ya: "peligro",
  pronto: "advertencia",
  saludable: "exito",
  sobrestock: "aviso",
  sin_ventas: "neutro",
};

export function ChipEstado({ estado }: { estado: EstadoProyeccion }) {
  return <Chip estado={ESTADO_CHIP[estado]}>{ETIQUETA_ESTADO[estado]}</Chip>;
}

export function formatoDias(dias: number | null): string {
  if (dias === null) return "—";
  return dias >= 100 ? `${Math.round(dias)} días` : `${dias.toLocaleString("es-CO", { maximumFractionDigits: 1 })} días`;
}

export function formatoUnidadesPorDia(v: number): string {
  return v.toLocaleString("es-CO", { maximumFractionDigits: 1, minimumFractionDigits: v > 0 && v < 10 ? 1 : 0 });
}

export function formatoFecha(fecha: Date | null): string {
  if (!fecha) return "—";
  return fecha.toLocaleDateString("es-CO", { day: "numeric", month: "short", timeZone: "America/Bogota" });
}

// Un cambio de ±8% es ruido; más que eso se marca sube o baja. El
// símbolo acompaña al color para no depender solo del color.
export function Tendencia({ porcentaje }: { porcentaje: number | null }) {
  if (porcentaje === null) return <span className={styles.tendencia} data-signo="igual">Sin ventas</span>;
  const signo = porcentaje > 8 ? "sube" : porcentaje < -8 ? "baja" : "igual";
  const simbolo = signo === "sube" ? "▲ +" : signo === "baja" ? "▼ " : "● ";
  return (
    <span className={styles.tendencia} data-signo={signo} title="Ventas por día de los últimos 7 días contra el promedio de 30">
      {simbolo}
      {porcentaje}%
    </span>
  );
}

export function BarraCobertura({ fila }: { fila: ResultadoProyeccion }) {
  const tope = 90;
  const dias = fila.diasCobertura;
  const ancho = dias === null ? 0 : Math.min(100, (dias / tope) * 100);
  const marca = Math.min(100, (fila.leadTimeDias / tope) * 100);
  return (
    <div className={styles.barra} role="img" aria-label={`Dura ${formatoDias(dias)}; el pedido tarda ${fila.leadTimeDias} días`}>
      <div className={styles.barraRelleno} data-estado={fila.estado} style={{ width: `${ancho}%` }} />
      <div className={styles.marcaEntrega} style={{ left: `${marca}%` }} />
    </div>
  );
}

export function SelectorVentana({ vista, activa, ventanas }: { vista: string; activa: number; ventanas: readonly number[] }) {
  return (
    <div className={styles.selectorVentana}>
      <span>Cuánto vendo por día, según los últimos:</span>
      {ventanas.map((d) => (
        <a key={d} href={`/panel/inventario/proyeccion?vista=${vista}&ventana=${d}`} className={styles.ventana} data-activa={d === activa ? "true" : "false"}>
          {d} días
        </a>
      ))}
    </div>
  );
}
