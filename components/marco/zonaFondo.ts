"use client";

import { useEffect, type RefObject } from "react";

// Tema claro: el fondo de la página es el degradado fijo de body::before,
// negro arriba y blanco abajo. Altura (px desde arriba de la pantalla)
// desde la que el texto oscuro lee mejor que el claro, por intensidad de
// fondo: el gris medio (#777) de cada rampa de --fondo-app-* de claro
// en app/globals.css (negro hasta 170/190/210px, blanco desde 270/290/310px).
export const CRUCE_ZONA_CLARA_PX: Record<string, number> = { suave: 217, medio: 237, intenso: 257 };

// Marca data-zona ("oscura" o "clara") en los elementos de `selector`
// dentro de `ref` (o en `ref` mismo si no hay selector), según dónde caen
// DE VERDAD sobre el degradado. Se recalcula al desplazar cualquier caja
// de la página, al cambiar el tamaño, el tema o el fondo, y cuando cambia
// el contenido. En oscuro no se marca nada. Lo usan BarraLateral y
// Pestanas.
export function useZonaFondo(ref: RefObject<HTMLElement>, selector: string | null, deps: readonly unknown[]) {
  useEffect(() => {
    const contenedor = ref.current;
    if (!contenedor) return;
    const raiz = document.documentElement;
    let pendiente = 0;
    function elementos(): HTMLElement[] {
      return selector ? Array.from(contenedor!.querySelectorAll<HTMLElement>(selector)) : [contenedor!];
    }
    function marcar() {
      pendiente = 0;
      if (raiz.dataset.tema !== "claro") {
        elementos().forEach((el) => el.removeAttribute("data-zona"));
        return;
      }
      const cruce = CRUCE_ZONA_CLARA_PX[raiz.dataset.fondo ?? "suave"] ?? CRUCE_ZONA_CLARA_PX.suave;
      elementos().forEach((el) => {
        const caja = el.getBoundingClientRect();
        el.dataset.zona = (caja.top + caja.bottom) / 2 < cruce ? "oscura" : "clara";
      });
    }
    function programar() {
      if (!pendiente) pendiente = window.requestAnimationFrame(marcar);
    }
    marcar();
    // En captura: el scroll de cualquier caja (la página o el menú) llega acá.
    document.addEventListener("scroll", programar, { capture: true, passive: true });
    window.addEventListener("resize", programar);
    const observador = new MutationObserver(programar);
    observador.observe(raiz, { attributes: true, attributeFilter: ["data-tema", "data-fondo"] });
    observador.observe(contenedor, { childList: true, subtree: true });
    // Un aviso que aparece arriba empuja el elemento sin que cambie él mismo.
    const tamano = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(programar);
    tamano?.observe(document.body);
    return () => {
      document.removeEventListener("scroll", programar, { capture: true });
      window.removeEventListener("resize", programar);
      observador.disconnect();
      tamano?.disconnect();
      if (pendiente) window.cancelAnimationFrame(pendiente);
    };
  }, deps);
}
