import styles from "./TarjetaKpi.module.css";

// Sin `valor` dice "Pendiente de conectar" por default — no inventa una
// cifra ni una curva. Quien ya tiene el dato lo pasa (en /panel, incluso
// "COP 0" o 0): eso no es este estado vacío. `detalle` son líneas en
// letra pequeña bajo la cifra (ej. el monto de "Ventas de hoy"); sin
// `detalle`, la tarjeta se ve igual que siempre.
//
// Issue #209/#210 — bug real reportado por Sharel en el smoke de
// staging: en Investigación (Demanda), un `valor` undefined significa
// "la búsqueda no trajo vendidos reales para ningún candidato" — NADA
// que ver con "falta conectar una cuenta de Mercado Libre" (ese caso ya
// se atrapa antes, como SinCuentaMlError, y nunca llega a esta tarjeta).
// `textoVacio` deja que cada pantalla elija su propio texto para el
// estado vacío sin tocar el default de /panel (Inicio) ni de
// /panel/avisos-ml, que sí dependen de "Pendiente de conectar" tal cual.
export function TarjetaKpi({
  titulo,
  valor,
  variacionPorcentaje,
  puntos,
  detalle,
  variacion,
  textoVacio = "Pendiente de conectar",
}: {
  titulo: string;
  valor?: string | number;
  variacionPorcentaje?: number;
  puntos?: number[];
  detalle?: string[];
  // Texto ya armado (con "mejor" o "peor"). `mejor` null = sin juicio
  // (igual, o sin datos): no se pinta verde ni rojo.
  variacion?: { texto: string; mejor: boolean | null };
  textoVacio?: string;
}) {
  const tieneValor = valor !== undefined;

  return (
    <div className={styles.tarjeta}>
      <p className={`zx-etiqueta ${styles.titulo}`}>{titulo}</p>

      {tieneValor ? (
        <>
          <p className={`${styles.valor} zx-texto-plata`}>{valor}</p>
          {variacion ? (
            <p
              className={styles.variacion}
              data-positiva={variacion.mejor === null ? undefined : variacion.mejor ? "true" : "false"}
            >
              {variacion.texto}
            </p>
          ) : null}
          {detalle?.map((linea, i) => (
            <p key={i} className={styles.detalle}>
              {linea}
            </p>
          ))}
          {variacionPorcentaje !== undefined && (
            <p className={styles.variacion} data-positiva={variacionPorcentaje >= 0 ? "true" : "false"}>
              {variacionPorcentaje >= 0 ? "+" : ""}
              {variacionPorcentaje}% vs. mes anterior
            </p>
          )}
          {puntos && puntos.length > 1 && <Sparkline puntos={puntos} />}
        </>
      ) : (
        <p className={styles.vacio}>{textoVacio}</p>
      )}
    </div>
  );
}

function Sparkline({ puntos }: { puntos: number[] }) {
  const ancho = 100;
  const alto = 28;
  const max = Math.max(...puntos);
  const min = Math.min(...puntos);
  const rango = max - min || 1;
  const coordenadas = puntos
    .map((valor, i) => {
      const x = (i / (puntos.length - 1)) * ancho;
      const y = alto - ((valor - min) / rango) * alto;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");

  return (
    <svg viewBox={`0 0 ${ancho} ${alto}`} className={styles.sparkline} preserveAspectRatio="none" aria-hidden="true">
      <polyline points={coordenadas} fill="none" stroke="var(--acento-fuerte)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
