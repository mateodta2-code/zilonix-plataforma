"use client";

import Link from "next/link";
import { useRef } from "react";
import styles from "./Pestanas.module.css";
import { useZonaFondo } from "./zonaFondo";

// `onSeleccionar`: pestaña local (no cambia de ruta) — se usa cuando las dos
// vistas deben seguir montadas para no perder lo escrito (ej. Publicar).
export type Pestana = { etiqueta: string; href: string; activa: boolean; deshabilitada?: boolean; onSeleccionar?: () => void };

export function Pestanas({ pestanas }: { pestanas: Pestana[] }) {
  // Tema claro: si un aviso de arriba empuja las pestañas a la parte
  // blanca del degradado, pasan a texto oscuro (data-zona="clara").
  const navRef = useRef<HTMLElement>(null);
  useZonaFondo(navRef, null, [pestanas]);
  return (
    <nav ref={navRef} className={styles.contenedor}>
      {pestanas.map((pestana) =>
        pestana.deshabilitada ? (
          <span key={pestana.href} className={styles.pestana} data-deshabilitada="true">
            {pestana.etiqueta}
          </span>
        ) : pestana.onSeleccionar ? (
          <button key={pestana.href} type="button" className={styles.pestana} data-activa={pestana.activa ? "true" : "false"} onClick={pestana.onSeleccionar}>
            {pestana.etiqueta}
          </button>
        ) : (
          <Link key={pestana.href} href={pestana.href} className={styles.pestana} data-activa={pestana.activa ? "true" : "false"}>
            {pestana.etiqueta}
          </Link>
        )
      )}
    </nav>
  );
}
