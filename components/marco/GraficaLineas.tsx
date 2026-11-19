// Issue #175 — gráfica de línea simple, SVG servido desde el propio
// Server Component (sin ninguna librería nueva: el repo no tiene
// ninguna todavía — ver package.json). Pensada para pocos puntos
// (historial diario de un seguimiento, nunca miles de filas), no para
// un dashboard de series de tiempo pesado. Optimización: el globo al
// pasar el mouse lo dibuja GraficaInteractiva (cliente); acá se calcula
// y se formatea todo, porque formatoValor es una función y no puede
// viajar al navegador.
import { GraficaInteractiva } from "./GraficaInteractiva";

// etiquetaLarga: lo que dice el globo (ej. "mar 18 nov"); sin ella, la
// etiqueta corta. extra: líneas de más bajo el valor (ej. las visitas
// de ese día en la gráfica de ventas).
export type PuntoGrafica = { etiqueta: string; valor: number | null; etiquetaLarga?: string; extra?: string[] };

const ANCHO = 600;
const ALTO = 160;
const MARGEN = 24;

export function GraficaLineas({
  titulo,
  puntos,
  formatoValor,
  nombreValor,
}: {
  titulo: string;
  puntos: PuntoGrafica[];
  formatoValor?: (n: number) => string;
  // Delante del valor en el globo (ej. "Unidades vendidas: 3").
  nombreValor?: string;
}) {
  const conDato = puntos.filter((p): p is PuntoGrafica & { valor: number } => p.valor != null);
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
  const formato = formatoValor ?? ((n: number) => String(n));
  const coordenadas = conDato.map((p, i) => ({
    x: MARGEN + i * paso,
    y: ALTO - MARGEN - ((p.valor - minimo) / rango) * (ALTO - MARGEN * 2),
    titulo: p.etiquetaLarga ?? p.etiqueta,
    valor: nombreValor ? `${nombreValor}: ${formato(p.valor)}` : formato(p.valor),
    extra: p.extra ?? [],
  }));

  return (
    <div>
      <p style={{ margin: "0 0 8px", fontWeight: 700, fontSize: 13 }}>{titulo}</p>
      <GraficaInteractiva titulo={titulo} ancho={ANCHO} alto={ALTO} margen={MARGEN} puntos={coordenadas} />
      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, color: "var(--texto-suave)" }}>
        <span>{conDato[0].etiqueta}</span>
        <span>{conDato[conDato.length - 1].etiqueta}</span>
      </div>
    </div>
  );
}
