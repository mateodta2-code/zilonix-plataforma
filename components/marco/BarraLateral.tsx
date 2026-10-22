"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { iconoDeClave, IconoContraer, IconoLogo } from "./iconos";
import { SelectorTema } from "./SelectorTema";
import styles from "./BarraLateral.module.css";
import type { GrupoNav } from "./tipos";

const CLAVE_COLAPSADA = "zilonix-barra-colapsada";

export function BarraLateral({ grupos }: { grupos: GrupoNav[] }) {
  // Igual que el tema: el primer render (servidor y cliente antes del
  // efecto) asume la barra expandida — si alguien la había contraído,
  // se corrige en el primer efecto. Acá sí es solo un ancho que
  // cambia, no colores de toda la pantalla, así que no hace falta el
  // script en <head> que sí necesita el tema.
  const [colapsada, setColapsada] = useState(false);

  useEffect(() => {
    try {
      setColapsada(localStorage.getItem(CLAVE_COLAPSADA) === "1");
    } catch {
      // Storage bloqueado — se queda expandida.
    }
  }, []);

  function alternarColapso() {
    const siguiente = !colapsada;
    setColapsada(siguiente);
    try {
      localStorage.setItem(CLAVE_COLAPSADA, siguiente ? "1" : "0");
    } catch {
      // Storage bloqueado — el colapso igual cambia para esta carga.
    }
  }

  return (
    <aside className={styles.barra} data-colapsada={colapsada ? "true" : "false"}>
      <div className={styles.logo}>
        <IconoLogo size={22} />
        {!colapsada && <span className={styles.nombreLogo}>Zilonix</span>}
      </div>

      <nav className={styles.nav}>
        {grupos.map((grupo, indice) => (
          <div key={grupo.etiqueta ?? `grupo-${indice}`} className={styles.grupo}>
            {grupo.etiqueta && !colapsada && <p className={`zx-etiqueta ${styles.etiquetaGrupo}`}>{grupo.etiqueta}</p>}
            {grupo.items.map((item) =>
              item.deshabilitada ? (
                <span key={item.href} className={styles.item} data-deshabilitado="true" title={item.titulo}>
                  {iconoDeClave(item.icono, { size: 18 })}
                  {!colapsada && <span className={styles.etiquetaItem}>{item.etiqueta}</span>}
                </span>
              ) : (
                <Link
                  key={item.href}
                  href={item.href}
                  className={styles.item}
                  data-activo={item.activa ? "true" : "false"}
                  title={colapsada ? item.etiqueta : undefined}
                >
                  {iconoDeClave(item.icono, { size: 18 })}
                  {!colapsada && <span className={styles.etiquetaItem}>{item.etiqueta}</span>}
                </Link>
              )
            )}
          </div>
        ))}
      </nav>

      <div className={styles.piePrincipal} data-colapsada={colapsada ? "true" : "false"}>
        <Link href="/cuenta" className={styles.botonCuadrado} title="Mi cuenta">
          {iconoDeClave("cuenta", { size: 16 })}
          {!colapsada && <span className={styles.etiquetaCuadrado}>Mi cuenta</span>}
        </Link>
        <SelectorTema variante="cuadrado" />
        <button type="button" onClick={alternarColapso} className={styles.botonCuadrado} title={colapsada ? "Expandir" : "Contraer"}>
          <IconoContraer size={16} />
          {!colapsada && <span className={styles.etiquetaCuadrado}>Contraer</span>}
        </button>
      </div>
    </aside>
  );
}
