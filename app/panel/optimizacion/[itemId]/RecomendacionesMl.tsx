import { Chip, type EstadoChip } from "@/components/marco/Chip";
import { Tarjeta } from "@/components/marco/Tarjeta";
import type { CalidadItemMl, CompetenciaItemMl, ExperienciaCompraMl } from "@/lib/ml/cliente";
import { formatearNumero } from "@/lib/ml/sitios";
import { armarRecomendaciones } from "@/lib/optimizacion/recomendaciones";
import estilos from "../page.module.css";
import styles from "./recomendaciones.module.css";

// Optimización — «Recomendaciones de Mercado Libre» en el detalle. Solo
// lectura: nada de acá cambia algo en Mercado Libre. Cada fila se lee por
// separado; si una falla (null), solo esa fila lo dice.

const SIN_RESPUESTA = "Mercado Libre no respondió";

// Color que da ML en la experiencia de compra -> tono del Chip.
export function tonoDeColor(color: string | null): EstadoChip {
  switch (color?.toLowerCase()) {
    case "green":
      return "exito";
    case "yellow":
    case "orange":
      return "advertencia";
    case "red":
      return "peligro";
    default:
      return "neutro";
  }
}

const NOMBRE_BOOST: Record<string, string> = {
  free_shipping: "Envío gratis",
  free_installments: "Cuotas sin interés",
  fulfillment: "Full",
  same_day_shipping: "Envío en el día",
  shipping_collect: "Envío por cobrar",
};

// Ancla de la sección del detalle donde se arregla cada recomendación.
const ANCLA_ORIGEN: Record<string, { href: string; texto: string }> = {
  calidad: { href: "#editar", texto: "Editar" },
};

export type DatosRecomendaciones = {
  calidad: CalidadItemMl | null;
  experiencia: ExperienciaCompraMl | null;
  competencia: CompetenciaItemMl | null;
  // false: la publicación no es de catálogo, no hay competencia que leer.
  competenciaAplica: boolean;
  item: { stock: number | null; estado: string | null };
  idioma: string;
};

export function RecomendacionesMl({ calidad, experiencia, competencia, competenciaAplica, item, idioma }: DatosRecomendaciones) {
  const recomendaciones = armarRecomendaciones({ competencia, calidad, experiencia, item });
  const problema = experiencia?.problemas.find((p) => p.solucion) ?? experiencia?.problemas[0] ?? null;
  const boosts = (competencia?.boosts ?? []).filter((b) => b.estado === "boosted" || b.estado === "opportunity" || b.estado === "not_boosted");

  return (
    <Tarjeta className={estilos.tarjeta}>
      <p className={estilos.seccion}>Recomendaciones de Mercado Libre</p>
      <div className={styles.filas}>
        <div className={styles.fila} data-fila="calidad">
          <p className={styles.filaTitulo}>Calidad</p>
          {calidad ? (
            <>
              <p className={styles.valor}>
                {calidad.puntaje !== null ? <strong>{formatearNumero(calidad.puntaje, idioma)}</strong> : null}
                {calidad.nivel ? <Chip>{calidad.nivel}</Chip> : null}
              </p>
              <p className={styles.nota}>
                {calidad.pendientes.length === 0
                  ? "Sin objetivos pendientes."
                  : `${formatearNumero(calidad.pendientes.length, idioma)} ${calidad.pendientes.length === 1 ? "objetivo pendiente" : "objetivos pendientes"}`}
              </p>
            </>
          ) : (
            <p className={styles.nota}>{SIN_RESPUESTA}</p>
          )}
        </div>

        <div className={styles.fila} data-fila="experiencia">
          <p className={styles.filaTitulo}>Experiencia</p>
          {experiencia ? (
            <>
              <p className={styles.valor}>
                <Chip estado={tonoDeColor(experiencia.color)}>{experiencia.texto ?? experiencia.titulo ?? "Sin dato"}</Chip>
                {experiencia.texto && experiencia.titulo ? <span>{experiencia.titulo}</span> : null}
              </p>
              {problema ? (
                <p className={styles.nota}>
                  {[problema.motivo, problema.detalle].filter(Boolean).join(" — ")}
                  {problema.solucion ? ` · Solución: ${problema.solucion}` : ""}
                </p>
              ) : null}
              {experiencia.congelada ? <p className={styles.nota}>{experiencia.congelada}</p> : null}
            </>
          ) : (
            <p className={styles.nota}>{SIN_RESPUESTA}</p>
          )}
        </div>

        <div className={styles.fila} data-fila="competencia">
          <p className={styles.filaTitulo}>Competencia</p>
          {!competenciaAplica ? (
            <p className={styles.nota}>No aplica: la publicación no es de catálogo.</p>
          ) : competencia ? (
            <>
              {competencia.estado ? (
                <p className={styles.valor}>
                  <Chip>{competencia.estado}</Chip>
                </p>
              ) : null}
              {boosts.length > 0 ? (
                <div className={styles.chips}>
                  {boosts.map((b) => (
                    <Chip key={b.id} estado={b.estado === "boosted" ? "exito" : b.estado === "opportunity" ? "advertencia" : "neutro"}>
                      {`${NOMBRE_BOOST[b.id] ?? b.descripcion ?? b.id}: ${b.estado === "boosted" ? "Tienes" : "Te falta"}`}
                    </Chip>
                  ))}
                </div>
              ) : null}
              {competencia.motivo ? <p className={styles.nota}>{competencia.motivo}</p> : null}
            </>
          ) : (
            <p className={styles.nota}>{SIN_RESPUESTA}</p>
          )}
        </div>
      </div>

      {recomendaciones.length > 0 ? (
        <ul className={styles.lista} aria-label="Recomendaciones">
          {recomendaciones.map((r) => (
            <li key={r.clave}>
              {r.texto}
              {ANCLA_ORIGEN[r.origen] ? <a href={ANCLA_ORIGEN[r.origen].href}>{ANCLA_ORIGEN[r.origen].texto}</a> : null}
            </li>
          ))}
        </ul>
      ) : (
        <p className={styles.notaVacia}>
          Mercado Libre no tiene recomendaciones para esta publicación.
        </p>
      )}
    </Tarjeta>
  );
}
