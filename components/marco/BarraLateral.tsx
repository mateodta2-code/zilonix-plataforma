"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { iconoDeClave, IconoContraer } from "./iconos";
import { ItemNavLink } from "./ItemNavLink";
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
        {/* Las tres imágenes siempre están en el DOM — cuál se ve es
            puro CSS (data-colapsada de .barra, más el media query de
            pantallas angostas que fuerza el ícono sin depender del
            estado de React). Mismo criterio que .etiquetaItem de
            abajo: nunca una condición de JS decide qué tan ancho cabe
            en la pantalla real.

            SVG oficial del manual de marca, nunca redibujado — mínimo
            260px de ancho (tamaño mínimo digital) y un margen de
            protección alrededor equivalente a 2x el ancho de la "I"
            del logotipo (medido en el propio SVG: la "I" mide 42.67
            de 933 unidades de ancho total ≈ 4.57% — a 260px eso es
            ~11.9px, así que el margen es ~24px). Nunca se estira, se
            rota, se recolorea ni se le agrega sombra/brillo/filtro.

            Ícono colapsado: recorte del propio logotipo (no un ícono
            genérico), mínimo 32px. En tema claro se cambia a la
            versión gris oscuro (icono-gris-oscuro.png) porque la
            plata pierde contraste sobre un fondo casi blanco — el
            logo completo SÍ se queda en plata sobre blanco en los dos
            temas, eso el manual lo permite explícitamente, el ícono
            solo no. */}
        <img src="/marca/zilonix-seller-logo.svg" alt="Zilonix Seller" className={styles.logoCompleto} width={260} height={94} />
        <img src="/marca/icono-plata.png" alt="Zilonix Seller" className={styles.iconoColapsado} data-variante="plata" />
        <img src="/marca/icono-gris-oscuro.png" alt="Zilonix Seller" className={styles.iconoColapsado} data-variante="oscuro" />
      </div>

      <nav className={styles.nav}>
        {grupos.map((grupo, indice) => (
          <div key={grupo.etiqueta ?? `grupo-${indice}`} className={styles.grupo}>
            {grupo.etiqueta && !colapsada && <p className={`zx-etiqueta ${styles.etiquetaGrupo}`}>{grupo.etiqueta}</p>}
            {grupo.items.map((item) => (
              <ItemNavLink key={item.href} item={item} colapsada={colapsada} />
            ))}
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
