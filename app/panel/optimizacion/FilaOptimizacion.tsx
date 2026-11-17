"use client";

import { useState, useTransition, type ReactNode } from "react";
import { Boton } from "@/components/marco/Boton";
import { CeldaTabla, FilaTabla } from "@/components/marco/Tabla";
import { Chip, type EstadoChip } from "@/components/marco/Chip";
import { FotoConZoom } from "@/components/marco/FotoConZoom";
import { etiquetaEstadoItemMl, etiquetaSubStatusItemMl } from "@/lib/ml/estado-publicacion";
import { cambiarEstadoPublicacionAction } from "./actions";
import styles from "./page.module.css";
import { useAvisoOptimizacion } from "./ToastOptimizacion";

export const COLUMNAS_OPTIMIZACION = 12;

const ESTADO_CHIP: Readonly<Record<string, EstadoChip>> = { active: "exito", paused: "advertencia", under_review: "aviso" };

// Una fila del listado. Lo que ya viene de la lista base (foto, título,
// ids, envío, tipo) llega por props; las métricas (precio con promoción,
// visitas, ventas, conversión, calidad, competencia) llegan ya armadas
// por el servidor dentro de <Suspense>, así la fila aparece antes de que
// terminen.
export function FilaOptimizacion(props: {
  cuentaId: string;
  itemId: string;
  titulo: string;
  thumbnail: string | null;
  permalink: string | null;
  sku: string | null;
  tipo: string | null;
  envioGratis: boolean | null;
  esFull: boolean;
  status: string | null;
  subStatus: string | null;
  puedeModificar: boolean;
  precio: ReactNode;
  visitas: ReactNode;
  ventas: ReactNode;
  conversion: ReactNode;
  calidad: ReactNode;
  competencia: ReactNode;
}) {
  const avisar = useAvisoOptimizacion();
  const [status, setStatus] = useState(props.status);
  const [confirmando, setConfirmando] = useState(false);
  const [abierta, setAbierta] = useState(false);
  const [pendiente, iniciar] = useTransition();

  const sub = status === props.status ? etiquetaSubStatusItemMl(props.subStatus) : null;
  const puedeCambiar = props.puedeModificar && (status === "active" || status === "paused");

  function aplicar(activar: boolean) {
    setConfirmando(false);
    iniciar(async () => {
      const r = await cambiarEstadoPublicacionAction({ cuentaId: props.cuentaId, itemId: props.itemId, activar });
      if (r.ok) {
        setStatus(r.status);
        avisar(`${props.itemId}: ${activar ? "publicación activada" : "publicación pausada"}.`, "exito");
      } else {
        // Mensaje tal cual lo da el helper (incluye el de "Mercado Libre
        // todavía está revisando esta publicación").
        avisar(r.mensaje, "peligro");
      }
    });
  }

  return (
    <>
      <FilaTabla>
        <CeldaTabla>
          <div className={styles.producto}>
            {props.thumbnail ? <FotoConZoom src={props.thumbnail} alt={props.titulo} claseMiniatura={styles.miniatura} /> : null}
            <div>
              <div className={styles.titulo}>{props.titulo}</div>
              <div className={styles.meta}>
                {props.permalink ? (
                  <a href={props.permalink} target="_blank" rel="noopener noreferrer">
                    {props.itemId}
                  </a>
                ) : (
                  props.itemId
                )}
                {props.sku ? ` · SKU ${props.sku}` : ""}
              </div>
            </div>
          </div>
        </CeldaTabla>
        <CeldaTabla numerica>{props.precio}</CeldaTabla>
        <CeldaTabla>{props.tipo ?? <span className={styles.nodisp}>—</span>}</CeldaTabla>
        <CeldaTabla>
          <div className={styles.chips}>
            {props.envioGratis ? <Chip estado="exito">Envío gratis</Chip> : null}
            {props.esFull ? <Chip estado="aviso">Full</Chip> : null}
            {!props.envioGratis && !props.esFull ? <span className={styles.nodisp}>—</span> : null}
          </div>
        </CeldaTabla>
        <CeldaTabla numerica>{props.visitas}</CeldaTabla>
        <CeldaTabla numerica>{props.ventas}</CeldaTabla>
        <CeldaTabla numerica>{props.conversion}</CeldaTabla>
        <CeldaTabla>{props.calidad}</CeldaTabla>
        <CeldaTabla>{props.competencia}</CeldaTabla>
        <CeldaTabla>
          <div className={styles.chips}>
            <Chip estado={(status && ESTADO_CHIP[status]) || "neutro"}>{etiquetaEstadoItemMl(status)}</Chip>
            {sub ? <Chip estado="neutro">{sub}</Chip> : null}
          </div>
        </CeldaTabla>
        <CeldaTabla>
          <div className={styles.accion}>
            {confirmando ? (
              <>
                <span>¿Pausar esta publicación?</span>
                <Boton chico variante="primario" onClick={() => aplicar(false)} disabled={pendiente}>
                  Sí, pausar
                </Boton>
                <Boton chico variante="fantasma" onClick={() => setConfirmando(false)}>
                  Cancelar
                </Boton>
              </>
            ) : (
              <Boton
                chico
                variante="secundario"
                disabled={!puedeCambiar || pendiente}
                title={
                  !props.puedeModificar
                    ? "Tu rol no puede pausar ni activar publicaciones."
                    : puedeCambiar
                      ? undefined
                      : "Solo se puede cambiar una publicación activa o pausada."
                }
                onClick={() => (status === "active" ? setConfirmando(true) : aplicar(true))}
              >
                {pendiente ? "Guardando…" : status === "active" ? "Pausar" : "Activar"}
              </Boton>
            )}
          </div>
        </CeldaTabla>
        <CeldaTabla>
          <button type="button" className={styles.expandir} aria-expanded={abierta} aria-label="Ver desglose" onClick={() => setAbierta((v) => !v)}>
            {abierta ? "▲" : "▼"}
          </button>
        </CeldaTabla>
      </FilaTabla>
      {abierta ? (
        <FilaTabla>
          <CeldaTabla colSpan={COLUMNAS_OPTIMIZACION}>
            <div className={styles.desglose}>Desglose (próximamente)</div>
          </CeldaTabla>
        </FilaTabla>
      ) : null}
    </>
  );
}
