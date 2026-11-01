// Issue #175 — gráfica de línea simple, SVG servido desde el propio
// Server Component (sin "use client", sin ninguna librería nueva: el
// repo no tiene ninguna todavía — ver package.json). Pensada para
// pocos puntos (historial diario de un seguimiento, nunca miles de
// filas), no para un dashboard de series de tiempo pesado.
export type PuntoGrafica = { etiqueta: string; valor: number | null };

const ANCHO = 600;
const ALTO = 160;
const MARGEN = 24;

export function GraficaLineas({ titulo, puntos, formatoValor }: { titulo: string; puntos: PuntoGrafica[]; formatoValor?: (n: number) => string }) {
  const conDato = puntos.filter((p): p is { etiqueta: string; valor: number } => p.valor != null);
  if (conDato.length < 2) {
    return (
      <div>
        <p style={{ margin: "0 0 8px", fontWeight: 700, fontSize: 13 }}>{titulo}</p>
        <p style={{ margin: 0, fontSize: 12.5, color: "var(--texto-suave)" }}>Todavía no hay suficientes días con dato real para graficar.</p>
      </div>
    );
  }

  const valores = conDato.map((p) => p.valor);
  const minimo = Math.min(...valores);
  const maximo = Math.max(...valores);
  // Si todos los valores son iguales, el rango sería 0 — se fuerza un
  // rango mínimo para que la línea no quede pegada al borde.
  const rango = maximo - minimo || 1;

  const paso = (ANCHO - MARGEN * 2) / (conDato.length - 1);
  const coordenadas = conDato.map((p, i) => {
    const x = MARGEN + i * paso;
    const y = ALTO - MARGEN - ((p.valor - minimo) / rango) * (ALTO - MARGEN * 2);
    return { x, y, punto: p };
  });

  const puntos_ = coordenadas.map((c) => `${c.x},${c.y}`).join(" ");
  const formato = formatoValor ?? ((n: number) => String(n));

  return (
    <div>
      <p style={{ margin: "0 0 8px", fontWeight: 700, fontSize: 13 }}>{titulo}</p>
      <svg viewBox={`0 0 ${ANCHO} ${ALTO}`} width="100%" height={ALTO} role="img" aria-label={titulo}>
        <polyline points={puntos_} fill="none" stroke="var(--acento)" strokeWidth={2} />
        {coordenadas.map((c, i) => (
          <circle key={i} cx={c.x} cy={c.y} r={3} fill="var(--acento)">
            <title>
              {c.punto.etiqueta}: {formato(c.punto.valor)}
            </title>
          </circle>
        ))}
      </svg>
      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, color: "var(--texto-suave)" }}>
        <span>{conDato[0].etiqueta}</span>
        <span>{conDato[conDato.length - 1].etiqueta}</span>
      </div>
    </div>
  );
}
