"use client";

import { useState } from "react";
import { Chip } from "@/components/marco/Chip";
import { Ayuda } from "@/components/marco/Ayuda";
import { URL_PUBLICIDAD_ML } from "@/lib/publicidad/config";
import { CeldaTabla, FilaTabla, Tabla } from "@/components/marco/Tabla";
import { EstadoVacio } from "@/components/marco/EstadoVacio";
import {
  AYUDA_SEMAFORO,
  COLUMNAS_CAMPANA,
  NOTA_DIAGNOSTICO,
  NOTA_VENTAS_ORGANICAS,
  ROTULO_COLUMNA_ANUNCIO,
  ROTULO_PERIODO,
} from "@/lib/publicidad/rotulos";
import type { CampanaPintada } from "./vista";
import styles from "./page.module.css";

export function TablaCampanas({ campanas }: { campanas: CampanaPintada[] }) {
  const [abiertas, setAbiertas] = useState<Record<string, boolean>>({});

  return (
    <>
      {campanas.map((campana) => {
        const abierta = Boolean(abiertas[campana.id]);
        const panelId = `anuncios-${campana.id}`;
        return (
          <FilaGrupo
            key={campana.id}
            campana={campana}
            abierta={abierta}
            panelId={panelId}
            onToggle={() => setAbiertas((prev) => ({ ...prev, [campana.id]: !prev[campana.id] }))}
          />
        );
      })}
    </>
  );
}

function FilaGrupo({
  campana,
  abierta,
  panelId,
  onToggle,
}: {
  campana: CampanaPintada;
  abierta: boolean;
  panelId: string;
  onToggle: () => void;
}) {
  return (
    <>
      <FilaTabla>
        <CeldaTabla fija className={styles.celdaCampana}>
          <button
            type="button"
            className={styles.expandir}
            aria-expanded={abierta}
            aria-controls={abierta ? panelId : undefined}
            onClick={onToggle}
          >
            <span className={styles.chevron} aria-hidden="true" />
            <span>
              <span className={styles.nombreCampana} title={campana.nombre}>
                {campana.nombre}
              </span>
              {campana.pausada ? <span className={styles.pausada}>{ROTULO_PERIODO.pausada}</span> : null}
            </span>
          </button>
        </CeldaTabla>
        <CeldaTabla className={styles.celdaEstado}>
          <span className={styles.estado}>
            <span className={styles.punto} data-tono={campana.estadoTono} aria-hidden="true" />
            <span className={styles.frase}>{campana.estadoFrase}</span>
            {campana.verificar ? <VerificarMl /> : null}
            {campana.estadoAvance !== null ? (
              <span className={styles.pista} aria-hidden="true">
                <span style={{ width: `${campana.estadoAvance}%` }} />
              </span>
            ) : null}
          </span>
        </CeldaTabla>
        <CeldaTabla numerica>{campana.inversion}</CeldaTabla>
        <CeldaTabla numerica>{campana.ventasPublicidad}</CeldaTabla>
        <CeldaTabla numerica>{campana.ventasSinPublicidad}</CeldaTabla>
        <CeldaTabla numerica>{campana.ventasTotales}</CeldaTabla>
        <CeldaTabla numerica className={styles.celdaRoas}>
          <span>{campana.roas}</span>
          {campana.roasObjetivo ? <span className={styles.roasObjetivo}>{campana.roasObjetivo}</span> : null}
        </CeldaTabla>
        <CeldaTabla numerica>{campana.acos}</CeldaTabla>
        <CeldaTabla numerica>{campana.tacos}</CeldaTabla>
        <CeldaTabla numerica>{campana.cpc}</CeldaTabla>
        <CeldaTabla numerica>{campana.clics}</CeldaTabla>
        <CeldaTabla numerica>{campana.impresiones}</CeldaTabla>
        <CeldaTabla numerica>{campana.unidades}</CeldaTabla>
        <CeldaTabla numerica className={styles.celdaPresupuesto}>
          <span>{campana.presupuesto}</span>
          {campana.presupuestoUsado ? <span className={styles.usado}>{campana.presupuestoUsado}</span> : null}
          {campana.presupuestoAvance !== null ? (
            <span className={styles.pista} aria-hidden="true">
              <span style={{ width: `${campana.presupuestoAvance}%` }} />
            </span>
          ) : null}
        </CeldaTabla>
      </FilaTabla>
      {abierta ? (
        <FilaTabla id={panelId}>
          <CeldaTabla colSpan={COLUMNAS_CAMPANA}>
            {campana.anuncios.length === 0 ? (
              <EstadoVacio>Esta campaña no tiene anuncios en la última sincronización.</EstadoVacio>
            ) : (
              <div className={styles.anuncios}>
                <Tabla
                  encabezados={[
                    ROTULO_COLUMNA_ANUNCIO.mco,
                    ROTULO_COLUMNA_ANUNCIO.titulo,
                    ROTULO_COLUMNA_ANUNCIO.cpc,
                    ROTULO_COLUMNA_ANUNCIO.clics,
                    ROTULO_COLUMNA_ANUNCIO.unidades,
                    ROTULO_COLUMNA_ANUNCIO.gasto,
                    {
                      clave: `vpub-${campana.id}`,
                      contenido: (
                        <span className={styles.rotuloColumna}>
                          <span>Ventas con</span>
                          <span>publicidad</span>
                        </span>
                      ),
                    },
                    ROTULO_COLUMNA_ANUNCIO.roas,
                    ROTULO_COLUMNA_ANUNCIO.acos,
                    {
                      clave: `organicas-${campana.id}`,
                      contenido: (
                        <span className={styles.thConAyuda}>
                          <span className={styles.rotuloColumna}>
                            <span>Ventas sin</span>
                            <span>publicidad</span>
                          </span>
                          <Ayuda id={`ayuda-organicas-${campana.id}`}>{NOTA_VENTAS_ORGANICAS}</Ayuda>
                        </span>
                      ),
                    },
                    ROTULO_COLUMNA_ANUNCIO.tacos,
                    {
                      clave: `semaforo-${campana.id}`,
                      contenido: (
                        <span className={styles.thConAyuda}>
                          {ROTULO_COLUMNA_ANUNCIO.semaforo}
                          <Ayuda id={`ayuda-semaforo-${campana.id}`}>{AYUDA_SEMAFORO}</Ayuda>
                        </span>
                      ),
                    },
                  ]}
                >
                  {campana.anuncios.map((anuncio) => (
                    <FilaTabla key={anuncio.clave}>
                      <CeldaTabla>
                        {anuncio.href ? (
                          <a className={styles.enlace} href={anuncio.href} target="_blank" rel="noopener noreferrer">
                            {anuncio.itemId}
                          </a>
                        ) : (
                          anuncio.itemId
                        )}
                      </CeldaTabla>
                      <CeldaTabla>{anuncio.titulo}</CeldaTabla>
                      <CeldaTabla numerica>{anuncio.cpc}</CeldaTabla>
                      <CeldaTabla numerica>{anuncio.clics}</CeldaTabla>
                      <CeldaTabla numerica>{anuncio.unidades}</CeldaTabla>
                      <CeldaTabla numerica>{anuncio.gasto}</CeldaTabla>
                      <CeldaTabla numerica>{anuncio.ventasPublicidad}</CeldaTabla>
                      <CeldaTabla numerica>{anuncio.roas}</CeldaTabla>
                      <CeldaTabla numerica>{anuncio.acos}</CeldaTabla>
                      <CeldaTabla numerica>{anuncio.ventasOrganicas}</CeldaTabla>
                      <CeldaTabla numerica>{anuncio.tacos}</CeldaTabla>
                      <CeldaTabla>
                        <Chip estado={anuncio.semaforoEstado} title={anuncio.semaforoTitle}>
                          {anuncio.semaforoRotulo}
                        </Chip>
                      </CeldaTabla>
                    </FilaTabla>
                  ))}
                </Tabla>
              </div>
            )}
          </CeldaTabla>
        </FilaTabla>
      ) : null}
    </>
  );
}

function IconoExterno() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
      <path d="M2.5 3.5h4M8 3.5H2.5V11H10V7" fill="none" stroke="currentColor" strokeWidth="1.2" />
      <path d="M7.5 2.2H12v4.5M12 2.2 6.8 7.4" fill="none" stroke="currentColor" strokeWidth="1.2" />
    </svg>
  );
}

function VerificarMl() {
  const etiqueta = NOTA_DIAGNOSTICO.verificarMl;
  if (URL_PUBLICIDAD_ML) {
    return (
      <a className={styles.iconoMl} href={URL_PUBLICIDAD_ML} target="_blank" rel="noopener noreferrer" aria-label={etiqueta} title={etiqueta}>
        <IconoExterno />
      </a>
    );
  }
  return (
    <span className={styles.iconoMl} role="img" aria-label={etiqueta} title="Pendiente de confirmar con Mateo la URL del panel de Product Ads.">
      <IconoExterno />
    </span>
  );
}
