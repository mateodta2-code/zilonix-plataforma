"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { iconoDeClave, IconoContraer } from "./iconos";
import { ItemNavLink } from "./ItemNavLink";
import { SelectorTema } from "./SelectorTema";
import styles from "./BarraLateral.module.css";
import type { GrupoNav } from "./tipos";

const CLAVE_COLAPSADA = "zilonix-barra-colapsada";

// Tema claro: el fondo de la barra es el degradado fijo de la página,
// negro arriba y blanco abajo. Altura (px desde arriba de la pantalla)
// desde la que el texto oscuro lee mejor que el claro, por intensidad de
// fondo: el gris medio (#777) de cada rampa de --fondo-app-* de claro
// en app/globals.css (negro hasta 170/190/210px, blanco desde 270/290/310px).
const CRUCE_ZONA_CLARA_PX: Record<string, number> = { suave: 217, medio: 237, intenso: 257 };

export function BarraLateral({
  grupos,
  etiquetaPanel,
  mostrarMisDatos = true,
}: {
  grupos: GrupoNav[];
  etiquetaPanel?: string;
  mostrarMisDatos?: boolean;
}) {
  // Igual que el tema: el primer render (servidor y cliente antes del
  // efecto) asume la barra expandida — si alguien la había contraído,
  // se corrige en el primer efecto. Acá sí es solo un ancho que
  // cambia, no colores de toda la pantalla, así que no hace falta el
  // script en <head> que sí necesita el tema.
  const [colapsada, setColapsada] = useState(false);
  const navRef = useRef<HTMLElement>(null);

  useEffect(() => {
    try {
      setColapsada(localStorage.getItem(CLAVE_COLAPSADA) === "1");
    } catch {
      // Storage bloqueado — se queda expandida.
    }
  }, []);

  // Cada ítem del menú marca data-zona ("oscura" o "clara") según dónde
  // cae DE VERDAD sobre el degradado, no por grupo: con muchos módulos o
  // una pantalla baja, los últimos del grupo principal bajaban a la zona
  // blanca con texto claro y no se leían (16-nov). Se recalcula al
  // desplazar el menú, al cambiar el tamaño, el tema o el fondo, y al
  // abrir un submenú. En oscuro no se marca nada.
  useEffect(() => {
    const nav = navRef.current;
    if (!nav) return;
    const raiz = document.documentElement;
    const selector = `.${styles.item}, .${styles.subitem}, .${styles.etiquetaGrupo}`;
    let pendiente = 0;
    function marcar() {
      pendiente = 0;
      const elementos = nav!.querySelectorAll<HTMLElement>(selector);
      if (raiz.dataset.tema !== "claro") {
        elementos.forEach((el) => el.removeAttribute("data-zona"));
        return;
      }
      const cruce = CRUCE_ZONA_CLARA_PX[raiz.dataset.fondo ?? "suave"] ?? CRUCE_ZONA_CLARA_PX.suave;
      elementos.forEach((el) => {
        const caja = el.getBoundingClientRect();
        el.dataset.zona = (caja.top + caja.bottom) / 2 < cruce ? "oscura" : "clara";
      });
    }
    function programar() {
      if (!pendiente) pendiente = window.requestAnimationFrame(marcar);
    }
    marcar();
    nav.addEventListener("scroll", programar, { passive: true });
    window.addEventListener("resize", programar);
    const observador = new MutationObserver(programar);
    observador.observe(raiz, { attributes: true, attributeFilter: ["data-tema", "data-fondo"] });
    observador.observe(nav, { childList: true, subtree: true });
    return () => {
      nav.removeEventListener("scroll", programar);
      window.removeEventListener("resize", programar);
      observador.disconnect();
      if (pendiente) window.cancelAnimationFrame(pendiente);
    };
  }, [colapsada, grupos]);

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

            SVG oficial del manual de marca, nunca redibujado — 260px
            de ancho exactos (tamaño mínimo digital, proporción del
            viewBox). El área de protección (2× el ancho de la "I") y
            el ancho de la barra están medidos en .barra, en el CSS:
            el margen que el SVG ya trae no se vuelve a sumar. Nunca
            se estira, se rota, se recolorea ni se le agrega
            sombra/brillo/filtro.

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
      {etiquetaPanel && !colapsada && <p className={`zx-etiqueta ${styles.tipoPanel}`}>{etiquetaPanel}</p>}

      <nav ref={navRef} className={styles.nav}>
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
        {/* Issue #318 — exportar/borrar los datos propios (Ley 1581),
        junto a "Mi cuenta": ninguno de los dos es un módulo de negocio
        de ninguna empresa. */}
        {mostrarMisDatos && (
          <Link href="/panel/mis-datos" className={styles.botonCuadrado} title="Mis datos personales">
            {iconoDeClave("datosPersonales", { size: 16 })}
            {!colapsada && <span className={styles.etiquetaCuadrado}>Mis datos</span>}
          </Link>
        )}
        <SelectorTema variante="cuadrado" />
        <button type="button" onClick={alternarColapso} className={styles.botonCuadrado} title={colapsada ? "Expandir" : "Contraer"}>
          <IconoContraer size={16} />
          {!colapsada && <span className={styles.etiquetaCuadrado}>Contraer</span>}
        </button>
      </div>
    </aside>
  );
}
