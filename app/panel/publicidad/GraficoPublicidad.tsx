"use client";

import { useState } from "react";
import type { KpiPintado, PuntoGrafico } from "./vista";
import styles from "./page.module.css";

const INICIAL = ["ventasAtribuidas", "roas"];
const LINEA = new Set(["roas", "acos", "tacos"]);

const CAMPO: Record<string, keyof PuntoGrafico> = {
  ventasAtribuidas: "ventasAtribuidas",
  otrasVentas: "otras",
  ingresos: "ingresos",
  inversion: "inversion",
  roas: "roas",
  acos: "acos",
  tacos: "tacos",
};

const COLOR: Record<string, string> = {
  ventasAtribuidas: "var(--acento)",
  otrasVentas: "var(--plata)",
  ingresos: "var(--acento-fuerte)",
  inversion: "var(--acento-fuerte)",
  roas: "var(--exito)",
  acos: "var(--peligro)",
  tacos: "var(--plata-oscuro)",
};

export function PanelMetricas({
  kpis,
  serie,
  aporte,
  comparar,
}: {
  kpis: KpiPintado[];
  serie: PuntoGrafico[];
  aporte: string | null;
  comparar: boolean;
}) {
  const [seleccion, setSeleccion] = useState<string[]>(INICIAL);
  const titulos = Object.fromEntries(kpis.map((kpi) => [kpi.clave, kpi.titulo]));

  function alternar(clave: string) {
    setSeleccion((actual) => {
      if (actual.includes(clave)) {
        const siguiente = actual.filter((item) => item !== clave);
        return siguiente.length === 0 ? actual : siguiente;
      }
      return [...actual, clave].slice(-2);
    });
  }

  return (
    <div className={styles.metricas}>
      <div className={styles.gridKpi}>
        {kpis.map((kpi) => {
          const orden = seleccion.indexOf(kpi.clave);
          const activa = orden >= 0;
          return (
            <button
              key={kpi.clave}
              type="button"
              className={styles.tarjetaMetrica}
              data-sel={activa ? String(orden + 1) : undefined}
              aria-pressed={activa}
              onClick={() => alternar(kpi.clave)}
            >
              <span className={styles.metricaTitulo}>{kpi.titulo}</span>
              <span className={styles.metricaValor}>{kpi.valor}</span>
              {comparar && kpi.delta ? (
                <span className={styles.delta} data-tono={tonoDelta(kpi.delta.mejor)} title={kpi.variacion.texto}>
                  {kpi.delta.texto}
                </span>
              ) : null}
            </button>
          );
        })}
      </div>
      <Grafico serie={serie} seleccion={seleccion} titulos={titulos} />
      <p className={styles.aporte}>
        Aporte por publicidad: {aporte ?? "—"}
        {aporte
          ? " de las ventas totales de tus publicaciones promocionadas."
          : " Faltan las ventas atribuidas o las otras ventas de este rango."}
      </p>
    </div>
  );
}

function tonoDelta(mejor: boolean | null): "mejor" | "peor" | "neutro" {
  if (mejor === null) return "neutro";
  return mejor ? "mejor" : "peor";
}

function valorDe(punto: PuntoGrafico, clave: string): number | null {
  const campo = CAMPO[clave];
  if (!campo || campo === "fecha") return null;
  const valor = punto[campo];
  return typeof valor === "number" ? valor : null;
}

function Grafico({
  serie,
  seleccion,
  titulos,
}: {
  serie: PuntoGrafico[];
  seleccion: string[];
  titulos: Record<string, string>;
}) {
  const barras = seleccion.filter((clave) => !LINEA.has(clave));
  const lineas = seleccion.filter((clave) => LINEA.has(clave));
  const apilada = barras.includes("ventasAtribuidas");
  const barrasSueltas = apilada ? barras.filter((clave) => clave !== "ventasAtribuidas" && clave !== "otrasVentas") : barras;
  const grupos = (apilada ? 1 : 0) + barrasSueltas.length;
  const hayAlgo = serie.some((punto) => {
    if (apilada && (punto.ventasAtribuidas !== null || punto.otras !== null)) return true;
    return seleccion.some((clave) => valorDe(punto, clave) !== null);
  });

  if (!hayAlgo) return <p className={styles.nota}>Sin datos diarios en este rango.</p>;

  const ancho = 800;
  const alto = 210;
  const margenIzq = 56;
  const maxBarra = maximo(
    serie.flatMap((punto) => {
      const valores: number[] = [];
      if (apilada && (punto.ventasAtribuidas !== null || punto.otras !== null)) {
        valores.push((punto.ventasAtribuidas ?? 0) + (punto.otras ?? 0));
      }
      for (const clave of barrasSueltas) {
        const valor = valorDe(punto, clave);
        if (valor !== null) valores.push(valor);
      }
      return valores;
    })
  );
  const maxLinea = maximo(
    serie.flatMap((punto) => lineas.map((clave) => valorDe(punto, clave)).filter((valor): valor is number => valor !== null))
  );
  const hayBarras = apilada || barrasSueltas.length > 0;
  const techoIzq = hayBarras ? maxBarra : maxLinea;
  const ejeDerecho = hayBarras && lineas.length > 0;
  const margenDer = ejeDerecho ? 48 : 12;
  const arriba = 12;
  const abajo = 22;
  const internoAncho = ancho - margenIzq - margenDer;
  const internoAlto = alto - arriba - abajo;
  const n = Math.max(serie.length, 1);
  const slot = internoAncho / n;
  const yDe = (valor: number, techo: number) => arriba + internoAlto - (techo === 0 ? 0 : (valor / techo) * internoAlto);
  const xCentro = (indice: number) => margenIzq + slot * indice + slot / 2;
  const leyenda: { color: string; texto: string }[] = [];
  if (apilada) {
    leyenda.push({ color: COLOR.ventasAtribuidas, texto: titulos.ventasAtribuidas ?? "Ventas atribuidas" });
    leyenda.push({ color: COLOR.otrasVentas, texto: titulos.otrasVentas ?? "Otras ventas" });
  }
  for (const clave of barrasSueltas) leyenda.push({ color: COLOR[clave] ?? "var(--acento)", texto: titulos[clave] ?? clave });
  for (const clave of lineas) leyenda.push({ color: COLOR[clave] ?? "var(--exito)", texto: titulos[clave] ?? clave });

  return (
    <figure className={styles.grafico}>
      <svg viewBox={`0 0 ${ancho} ${alto}`} role="img" aria-label="Serie diaria de las métricas elegidas">
        {[0, 0.5, 1].map((marca) => {
          const y = arriba + internoAlto - marca * internoAlto;
          return (
            <g key={marca}>
              <line x1={margenIzq} x2={ancho - margenDer} y1={y} y2={y} className={styles.eje} />
              <text x={margenIzq - 6} y={y + 3} textAnchor="end" className={styles.ejeTexto}>
                {formatoEje(techoIzq * marca)}
              </text>
              {ejeDerecho ? (
                <text x={ancho - margenDer + 6} y={y + 3} textAnchor="start" className={styles.ejeTexto}>
                  {formatoEje(maxLinea * marca)}
                </text>
              ) : null}
            </g>
          );
        })}
        {serie.map((punto, indice) => {
          const anchoBarra = Math.max(2, (slot * 0.62) / Math.max(grupos, 1));
          const origen = xCentro(indice) - (anchoBarra * Math.max(grupos, 1)) / 2;
          const paso = serie.length > 16 ? 5 : 1;
          return (
            <g key={punto.fecha}>
              {apilada ? <BarraApilada punto={punto} x={origen} ancho={anchoBarra} yDe={(valor) => yDe(valor, maxBarra)} /> : null}
              {barrasSueltas.map((clave, orden) => {
                const valor = valorDe(punto, clave);
                if (valor === null) return null;
                const y = yDe(valor, maxBarra);
                const y0 = yDe(0, maxBarra);
                return (
                  <rect
                    key={clave}
                    x={origen + anchoBarra * ((apilada ? 1 : 0) + orden)}
                    width={anchoBarra}
                    y={y}
                    height={Math.max(0, y0 - y)}
                    fill={COLOR[clave]}
                  />
                );
              })}
              {indice % paso === 0 ? (
                <text x={xCentro(indice)} y={alto - 6} textAnchor="middle" className={styles.ejeTexto}>
                  {Number(punto.fecha.slice(8))}
                </text>
              ) : null}
            </g>
          );
        })}
        {lineas.map((clave) => (
          <g key={clave}>
            {rutas(serie.map((punto) => valorDe(punto, clave)), xCentro, (valor) => yDe(valor, maxLinea)).map((d, indice) => (
              <path key={indice} d={d} fill="none" stroke={COLOR[clave]} strokeWidth="2" />
            ))}
            {serie.map((punto, indice) => {
              const valor = valorDe(punto, clave);
              if (valor === null) return null;
              return <circle key={punto.fecha} cx={xCentro(indice)} cy={yDe(valor, maxLinea)} r="2.5" fill={COLOR[clave]} />;
            })}
          </g>
        ))}
      </svg>
      <ul className={styles.leyenda}>
        {leyenda.map((item) => (
          <li key={item.texto}>
            <span className={styles.muestra} style={{ background: item.color }} aria-hidden="true" />
            {item.texto}
          </li>
        ))}
      </ul>
    </figure>
  );
}

function BarraApilada({
  punto,
  x,
  ancho,
  yDe,
}: {
  punto: PuntoGrafico;
  x: number;
  ancho: number;
  yDe: (valor: number) => number;
}) {
  const atribuidas = punto.ventasAtribuidas;
  const otras = punto.otras;
  if (atribuidas === null && otras === null) return null;
  const base = atribuidas ?? 0;
  const y0 = yDe(0);
  const yAtribuidas = yDe(base);
  const yTecho = yDe(base + (otras ?? 0));
  return (
    <>
      {atribuidas !== null ? (
        <rect x={x} width={ancho} y={yAtribuidas} height={Math.max(0, y0 - yAtribuidas)} fill="var(--acento)" />
      ) : null}
      {otras !== null ? (
        <rect x={x} width={ancho} y={yTecho} height={Math.max(0, yAtribuidas - yTecho)} fill="var(--plata)" />
      ) : null}
    </>
  );
}

function rutas(
  valores: (number | null)[],
  xCentro: (indice: number) => number,
  yDe: (valor: number) => number
): string[] {
  const salida: string[] = [];
  let trazo = "";
  valores.forEach((valor, indice) => {
    if (valor === null) {
      if (trazo) salida.push(trazo);
      trazo = "";
      return;
    }
    const comando = trazo ? "L" : "M";
    trazo += `${comando}${xCentro(indice)} ${yDe(valor)}`;
  });
  if (trazo) salida.push(trazo);
  return salida;
}

function maximo(valores: number[]): number {
  const positivos = valores.filter((valor) => Number.isFinite(valor) && valor > 0);
  if (positivos.length === 0) return 1;
  return Math.max(...positivos);
}

function formatoEje(valor: number): string {
  if (!Number.isFinite(valor)) return "";
  return new Intl.NumberFormat("es-CO", { notation: "compact", maximumFractionDigits: 1 }).format(valor);
}
