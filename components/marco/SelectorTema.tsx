"use client";

import { useEffect, useState } from "react";
import { IconoLuna, IconoSol } from "./iconos";
import styles from "./SelectorTema.module.css";

const CLAVE_TEMA = "zilonix-tema";

// Aparece dos veces en la pantalla (barra superior y el botón chico de
// la barra lateral) — cada instancia observa el atributo data-tema de
// <html> con un MutationObserver, así que cambiar el tema desde
// cualquiera de las dos lo refleja en la otra sin un store global.
function useTema() {
  // El script de app/layout.tsx ya puso data-tema antes de pintar,
  // pero el primer render de este componente en el servidor no tiene
  // document — se asume "oscuro" (el valor por defecto de la app) y
  // se corrige en el primer efecto si el real era "claro". Ese único
  // posible cambio de ícono, no de toda la pantalla, es el único
  // parpadeo que queda, a propósito: el que de verdad importa
  // evitar es el del fondo/colores, que ya resuelve el script.
  const [tema, setTema] = useState<"oscuro" | "claro">("oscuro");

  useEffect(() => {
    const raiz = document.documentElement;
    setTema(raiz.getAttribute("data-tema") === "claro" ? "claro" : "oscuro");

    const observador = new MutationObserver(() => {
      setTema(raiz.getAttribute("data-tema") === "claro" ? "claro" : "oscuro");
    });
    observador.observe(raiz, { attributes: true, attributeFilter: ["data-tema"] });
    return () => observador.disconnect();
  }, []);

  function alternar() {
    const siguiente = tema === "claro" ? "oscuro" : "claro";
    document.documentElement.setAttribute("data-tema", siguiente);
    try {
      localStorage.setItem(CLAVE_TEMA, siguiente);
    } catch {
      // Ventana privada o storage bloqueado — el tema igual cambia
      // para esta carga, solo no se recuerda la próxima vez.
    }
  }

  return { tema, alternar };
}

export function SelectorTema({ variante = "icono" }: { variante?: "icono" | "cuadrado" }) {
  const { tema, alternar } = useTema();
  const siguienteEsClaro = tema === "oscuro";
  const etiquetaAccion = siguienteEsClaro ? "Modo claro" : "Modo oscuro";

  if (variante === "cuadrado") {
    return (
      <button type="button" onClick={alternar} className={styles.botonCuadrado} title={etiquetaAccion}>
        {siguienteEsClaro ? <IconoSol size={16} /> : <IconoLuna size={16} />}
        <span className={styles.etiquetaCuadrado}>Tema</span>
      </button>
    );
  }

  return (
    <button type="button" onClick={alternar} className={styles.botonIcono} aria-label={etiquetaAccion} title={etiquetaAccion}>
      {siguienteEsClaro ? <IconoSol size={18} /> : <IconoLuna size={18} />}
    </button>
  );
}
