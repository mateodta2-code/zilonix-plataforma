"use client";

/**
 * Banda azul de carga con barra de progreso (extraída de Promociones, Promo-G).
 *
 * Uso:
 *   <BarraCarga
 *     estado={cargando ? "cargando" : terminoOk ? "completa" : hayMas ? "detenida" : "inactiva"}
 *     titulo={`Cargando publicaciones… ${n} revisadas`}
 *     avance={total ? { hechos: n, total } : null}   // sin total → barra indeterminada
 *     unidad="revisadas"                              // detalle «N de M revisadas (P %)»
 *     accion={{ texto: "Detener carga", onClick: detener }}
 *     textoDetenida="Carga detenida · N revisadas."
 *     alSeguir={seguir}
 *     textoInactiva="Listo — N publicaciones revisadas."
 *   />
 *
 * El contenedor role="status" queda siempre montado para que los lectores de
 * pantalla anuncien los cambios. «completa» se muestra `duracionCompletaMs`
 * (4 s por defecto) y luego se oculta sola. La animación indeterminada es solo
 * CSS (transform) y se apaga con prefers-reduced-motion.
 */
import { useEffect, useState } from "react";
import { Boton } from "@/components/marco/Boton";
import { formatearNumero } from "@/lib/ml/sitios";
import styles from "./BarraCarga.module.css";

export type EstadoBarraCarga = "cargando" | "completa" | "detenida" | "inactiva";

type Props = {
  titulo: string;
  estado: EstadoBarraCarga;
  avance?: { hechos: number; total: number } | null;
  /** Texto tras «N de M» en el detalle, ej. «revisadas». */
  unidad?: string;
  accion?: { texto: string; onClick: () => void };
  alSeguir?: () => void;
  textoSeguir?: string;
  textoDetenida?: string;
  textoCompleta?: string;
  /** Texto cuando no hay carga activa ni pendiente (también tras ocultarse «completa»). */
  textoInactiva?: string;
  duracionCompletaMs?: number;
  sticky?: boolean;
  ariaLabel?: string;
  idioma?: string;
};

export function BarraCarga({
  titulo,
  estado,
  avance,
  unidad = "",
  accion,
  alSeguir,
  textoSeguir = "Seguir cargando",
  textoDetenida,
  textoCompleta = "Carga completa",
  textoInactiva,
  duracionCompletaMs = 4000,
  sticky = true,
  ariaLabel = "Progreso de la carga",
  idioma = "es",
}: Props) {
  const [completaVisible, setCompletaVisible] = useState(true);

  useEffect(() => {
    if (estado !== "completa") return;
    setCompletaVisible(true);
    const id = setTimeout(() => setCompletaVisible(false), duracionCompletaMs);
    return () => clearTimeout(id);
  }, [estado, duracionCompletaMs]);

  const mostrarBanda = estado === "cargando" || (estado === "completa" && completaVisible);
  const conTotal = !!avance && avance.total > 0;
  const pct = estado === "completa" ? 100 : conTotal ? Math.min(100, Math.round((avance!.hechos / avance!.total) * 100)) : 0;
  const indeterminada = estado === "cargando" && !conTotal;

  const hayContenido = mostrarBanda || estado === "detenida" || !!textoInactiva;

  return (
    <div className={`${styles.contenedor} ${hayContenido ? styles.caja : ""} ${sticky ? styles.sticky : ""}`} role="status" aria-live="polite">
      {mostrarBanda ? (
        <div className={styles.banda}>
          <div className={styles.fila}>
            <span className={styles.titulo}>{estado === "cargando" ? titulo : textoCompleta}</span>
            {estado === "cargando" && accion && (
              <Boton type="button" variante="secundario" onClick={accion.onClick}>
                {accion.texto}
              </Boton>
            )}
          </div>
          <div
            className={`${styles.barra} ${indeterminada ? styles.indeterminada : ""}`}
            {...(!indeterminada ? { role: "progressbar", "aria-valuemin": 0, "aria-valuemax": 100, "aria-valuenow": pct, "aria-label": ariaLabel } : {})}
          >
            <div className={styles.relleno} style={indeterminada ? undefined : { width: `${pct}%` }} />
          </div>
          {estado === "cargando" && conTotal && (
            <span className={styles.detalle}>
              {formatearNumero(avance!.hechos, idioma)} de {formatearNumero(avance!.total, idioma)}
              {unidad ? ` ${unidad}` : ""} ({pct} %)
            </span>
          )}
        </div>
      ) : estado === "detenida" ? (
        <>
          <span>{textoDetenida ?? titulo}</span>
          {alSeguir && (
            <Boton type="button" variante="primario" onClick={alSeguir}>
              {textoSeguir}
            </Boton>
          )}
        </>
      ) : textoInactiva ? (
        <span>{textoInactiva}</span>
      ) : null}
    </div>
  );
}
