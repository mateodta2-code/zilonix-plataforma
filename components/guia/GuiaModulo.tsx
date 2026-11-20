"use client";

import { usePathname } from "next/navigation";
import { seccionDeRuta } from "@/lib/guia/contenido";
import styles from "./GuiaModulo.module.css";

// «Guía de este módulo», desplegable arriba de cada pantalla del panel
// que tiene guía (lib/guia/contenido.ts). Cerrada por defecto para no
// tapar el trabajo. El layout es de servidor y no conoce la ruta: se
// calcula acá, como ItemNavLink.
export function GuiaModulo() {
  const seccion = seccionDeRuta(usePathname() ?? "");
  if (!seccion) return null;
  return (
    <details key={seccion.id} className={styles.guia}>
      <summary className={styles.resumen}>
        Guía de este módulo<span className={styles.modulo}> · {seccion.titulo}</span>
      </summary>
      <div className={styles.cuerpo}>
        <p className={styles.paraQue}>{seccion.paraQue}</p>
        <p className={styles.subtitulo}>Paso a paso</p>
        <ol className={styles.pasos}>
          {seccion.pasos.map((p) => (
            <li key={p}>{p}</li>
          ))}
        </ol>
        {(seccion.apartados ?? []).map((a) => (
          <div key={a.titulo}>
            <p className={styles.subtitulo}>{a.titulo}</p>
            <ol className={styles.pasos}>
              {a.pasos.map((p) => (
                <li key={p}>{p}</li>
              ))}
            </ol>
          </div>
        ))}
        {seccion.consejos && seccion.consejos.length > 0 ? (
          <>
            <p className={styles.subtitulo}>Ten en cuenta</p>
            <ul className={styles.consejos}>
              {seccion.consejos.map((c) => (
                <li key={c}>{c}</li>
              ))}
            </ul>
          </>
        ) : null}
      </div>
    </details>
  );
}
