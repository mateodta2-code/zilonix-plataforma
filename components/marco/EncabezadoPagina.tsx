"use client";

import { useRef } from "react";
import styles from "./EncabezadoPagina.module.css";
import { useZonaFondo } from "./zonaFondo";

// Título de página + descripción opcional + una acción opcional a la
// derecha (un botón, un link) — mismo patrón repetido en casi todas
// las subpáginas de /panel, antes como un <h1 style={{...}}> suelto.
//
// Corrección (fix-ui-claro-como-oscuro): .titulo ya no usa la clase
// global zx-texto-plata — este encabezado cae siempre justo debajo
// del header, dentro de la franja oscura del degradado (en los dos
// temas), y zx-texto-plata usa --degradado-plata-texto, que en claro
// es gris oscuro metalizado (pensado para fondo BLANCO, ilegible
// sobre la franja oscura). .titulo trae su propio degradado plata
// (zona oscura) directo en el CSS.
//
// 17-nov: en tema claro la franja negra termina justo debajo del
// título. Una descripción larga o un título que baja (celular, aviso
// arriba) puede caer en la parte blanca: el título y la descripción
// marcan data-zona y ahí usan los colores normales del tema claro.
export function EncabezadoPagina({
  titulo,
  descripcion,
  accion,
}: {
  titulo: string;
  descripcion?: React.ReactNode;
  accion?: React.ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useZonaFondo(ref, `.${styles.titulo}, .${styles.descripcion}`, [titulo]);
  return (
    <div ref={ref} className={styles.encabezado}>
      <div>
        <h1 className={styles.titulo}>{titulo}</h1>
        {descripcion && <p className={styles.descripcion}>{descripcion}</p>}
      </div>
      {accion && <div className={styles.accion}>{accion}</div>}
    </div>
  );
}
