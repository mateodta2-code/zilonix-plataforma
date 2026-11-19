"use client";

import { useEffect, useRef, useState } from "react";

// La parte del navegador de GraficaLineas: al pasar el mouse (o el
// dedo) por la gráfica se marca el día más cercano y se muestra su
// fecha y su valor. Recibe todo ya calculado y formateado desde el
// servidor (una función no se puede pasar a un componente de cliente).
export type PuntoInteractivo = { x: number; y: number; titulo: string; valor: string; extra: string[] };

// Puro, para probarlo sin navegador: xEnCaja = píxeles desde el borde
// izquierdo del SVG en pantalla.
export function puntoBajoCursor(
  xEnCaja: number,
  anchoCaja: number,
  altoCaja: number,
  ancho: number,
  alto: number,
  puntos: { x: number }[]
): { indice: number; izquierdaPx: number; haciaIzquierda: boolean } | null {
  if (anchoCaja <= 0 || altoCaja <= 0 || puntos.length === 0) return null;
  const escala = Math.min(anchoCaja / ancho, altoCaja / alto);
  const margenX = (anchoCaja - ancho * escala) / 2;
  const x = (xEnCaja - margenX) / escala;
  let cercano = 0;
  for (let i = 1; i < puntos.length; i++) {
    if (Math.abs(puntos[i].x - x) < Math.abs(puntos[cercano].x - x)) cercano = i;
  }
  const izquierdaPx = margenX + puntos[cercano].x * escala;
  // A la derecha del punto, salvo cerca del borde derecho.
  return { indice: cercano, izquierdaPx, haciaIzquierda: izquierdaPx > anchoCaja * 0.7 };
}

// Los puntos llegan calculados para un dibujo de `ancho` (600). Para que
// la gráfica ocupe todo el ancho de la tarjeta, se mide el contenedor y
// se reparten los x en ese ancho real (mismo margen a los lados); el alto
// no cambia, así que los puntos siguen redondos (nunca se estira el SVG).
export function escalarX(x: number, ancho: number, anchoReal: number, margen: number): number {
  if (anchoReal <= 0 || ancho <= margen * 2) return x;
  return margen + ((x - margen) * (anchoReal - margen * 2)) / (ancho - margen * 2);
}

export function GraficaInteractiva({
  titulo,
  ancho,
  alto,
  margen,
  puntos: puntosBase,
}: {
  titulo: string;
  ancho: number;
  alto: number;
  margen: number;
  puntos: PuntoInteractivo[];
}) {
  const contenedor = useRef<HTMLDivElement>(null);
  // null hasta medir (en el servidor y el primer pintado se ve como antes).
  const [anchoReal, setAnchoReal] = useState<number | null>(null);
  useEffect(() => {
    const nodo = contenedor.current;
    if (!nodo) return;
    const medir = () => setAnchoReal(Math.round(nodo.getBoundingClientRect().width) || null);
    medir();
    if (typeof ResizeObserver === "undefined") return;
    const observador = new ResizeObserver(medir);
    observador.observe(nodo);
    return () => observador.disconnect();
  }, []);
  const anchoDibujo = anchoReal ?? ancho;
  const puntos = anchoReal === null ? puntosBase : puntosBase.map((p) => ({ ...p, x: escalarX(p.x, ancho, anchoReal, margen) }));

  // activo = índice del punto; izquierdaPx = dónde cae ese punto en
  // pantalla, para poner el globo justo ahí.
  const [activo, setActivo] = useState<{ indice: number; izquierdaPx: number; haciaIzquierda: boolean } | null>(null);

  // El SVG se dibuja con preserveAspectRatio "meet" (el de siempre): a lo
  // ancho queda centrado y escalado por el alto, con margen vacío a los
  // lados. Hay que pasar del píxel de la pantalla a la coordenada del
  // dibujo con esa misma escala y ese margen; si no, el punto marcado no
  // coincide con el cursor (bug visto en staging).
  function alMover(evento: React.PointerEvent<SVGSVGElement>) {
    const caja = evento.currentTarget.getBoundingClientRect();
    setActivo(puntoBajoCursor(evento.clientX - caja.left, caja.width, caja.height, anchoDibujo, alto, puntos));
  }

  const p = activo === null ? null : puntos[activo.indice];

  return (
    <div ref={contenedor} style={{ position: "relative" }}>
      <svg
        viewBox={`0 0 ${anchoDibujo} ${alto}`}
        width="100%"
        height={alto}
        role="img"
        aria-label={titulo}
        onPointerMove={alMover}
        onPointerDown={alMover}
        onPointerLeave={() => setActivo(null)}
        style={{ touchAction: "pan-y", cursor: "crosshair" }}
      >
        <polyline points={puntos.map((c) => `${c.x},${c.y}`).join(" ")} fill="none" stroke="var(--acento)" strokeWidth={2} />
        {p ? <line x1={p.x} x2={p.x} y1={0} y2={alto} stroke="var(--borde-hover)" strokeDasharray="3 3" /> : null}
        {puntos.map((c, i) => (
          <circle
            key={i}
            cx={c.x}
            cy={c.y}
            r={i === activo?.indice ? 5 : 3}
            fill="var(--acento)"
            stroke={i === activo?.indice ? "var(--fondo)" : "none"}
            strokeWidth={2}
          />
        ))}
      </svg>
      {p && activo ? (
        <div
          role="status"
          style={{
            position: "absolute",
            top: 4,
            left: activo.izquierdaPx,
            transform: activo.haciaIzquierda ? "translateX(calc(-100% - 10px))" : "translateX(10px)",
            pointerEvents: "none",
            background: "var(--superficie)",
            border: "1px solid var(--borde)",
            borderRadius: 8,
            padding: "6px 10px",
            fontSize: 12.5,
            whiteSpace: "nowrap",
            boxShadow: "0 4px 14px rgba(0, 0, 0, 0.25)",
            zIndex: 2,
          }}
        >
          <div style={{ color: "var(--texto-suave)" }}>{p.titulo}</div>
          <div style={{ fontWeight: 700 }}>{p.valor}</div>
          {p.extra.map((linea) => (
            <div key={linea} style={{ color: "var(--texto-suave)" }}>
              {linea}
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}
