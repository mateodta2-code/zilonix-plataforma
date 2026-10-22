import styles from "./TarjetaKpi.module.css";

// Sin `valor` dice "Pendiente de conectar" — no inventa una cifra ni
// una curva. Quien ya tiene el dato lo pasa (en /panel, incluso "COP 0"
// o 0): eso no es este estado vacío.
export function TarjetaKpi({
  titulo,
  valor,
  variacionPorcentaje,
  puntos,
}: {
  titulo: string;
  valor?: string | number;
  variacionPorcentaje?: number;
  puntos?: number[];
}) {
  const tieneValor = valor !== undefined;

  return (
    <div className={styles.tarjeta}>
      <p className={`zx-etiqueta ${styles.titulo}`}>{titulo}</p>

      {tieneValor ? (
        <>
          <p className={`${styles.valor} zx-texto-plata`}>{valor}</p>
          {variacionPorcentaje !== undefined && (
            <p className={styles.variacion} data-positiva={variacionPorcentaje >= 0 ? "true" : "false"}>
              {variacionPorcentaje >= 0 ? "+" : ""}
              {variacionPorcentaje}% vs. mes anterior
            </p>
          )}
          {puntos && puntos.length > 1 && <Sparkline puntos={puntos} />}
        </>
      ) : (
        <p className={styles.vacio}>Pendiente de conectar</p>
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
