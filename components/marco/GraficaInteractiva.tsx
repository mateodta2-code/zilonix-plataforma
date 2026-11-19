"use client";

import { useState } from "react";

// La parte del navegador de GraficaLineas: al pasar el mouse (o el
// dedo) por la gráfica se marca el día más cercano y se muestra su
// fecha y su valor. Recibe todo ya calculado y formateado desde el
// servidor (una función no se puede pasar a un componente de cliente).
export type PuntoInteractivo = { x: number; y: number; titulo: string; valor: string; extra: string[] };

export function GraficaInteractiva({
  titulo,
  ancho,
  alto,
  puntos,
}: {
  titulo: string;
  ancho: number;
  alto: number;
  puntos: PuntoInteractivo[];
}) {
  const [activo, setActivo] = useState<number | null>(null);

  function alMover(evento: React.PointerEvent<SVGSVGElement>) {
    const caja = evento.currentTarget.getBoundingClientRect();
    if (caja.width === 0) return;
    const x = ((evento.clientX - caja.left) / caja.width) * ancho;
    let cercano = 0;
    for (let i = 1; i < puntos.length; i++) {
      if (Math.abs(puntos[i].x - x) < Math.abs(puntos[cercano].x - x)) cercano = i;
    }
    setActivo(cercano);
  }

  const p = activo === null ? null : puntos[activo];
  // A la derecha del punto, salvo cerca del borde derecho.
  const izquierda = p ? `${(p.x / ancho) * 100}%` : "0";
  const haciaIzquierda = p ? p.x > ancho * 0.7 : false;

  return (
    <div style={{ position: "relative" }}>
      <svg
        viewBox={`0 0 ${ancho} ${alto}`}
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
          <circle key={i} cx={c.x} cy={c.y} r={i === activo ? 5 : 3} fill="var(--acento)" stroke={i === activo ? "var(--fondo)" : "none"} strokeWidth={2} />
        ))}
      </svg>
      {p ? (
        <div
          role="status"
          style={{
            position: "absolute",
            top: 4,
            left: izquierda,
            transform: haciaIzquierda ? "translateX(calc(-100% - 10px))" : "translateX(10px)",
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
