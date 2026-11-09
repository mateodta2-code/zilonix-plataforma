"use client";

import { useState } from "react";
import { Chip } from "@/components/marco/Chip";
import { Ayuda } from "@/components/marco/Ayuda";
import { CeldaTabla, FilaTabla, Tabla } from "@/components/marco/Tabla";
import { EstadoVacio } from "@/components/marco/EstadoVacio";
import { AYUDA_SEMAFORO, COLUMNAS_CAMPANA, NOTA_UNIDADES, NOTA_VENTAS_ORGANICAS } from "@/lib/publicidad/rotulos";
import type { CampanaPintada, DeltaPintado } from "./vista";
import styles from "./page.module.css";

export function TablaCampanas({ campanas, comparar }: { campanas: CampanaPintada[]; comparar: boolean }) {
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
            comparar={comparar}
            panelId={panelId}
            onToggle={() => setAbiertas((prev) => ({ ...prev, [campana.id]: !prev[campana.id] }))}
          />
        );
      })}
    </>
  );
}

export function TablaAnuncios({ campanas }: { campanas: CampanaPintada[] }) {
  const filas = campanas.flatMap((campana) => campana.anuncios.map((anuncio) => ({ ...anuncio, campana: campana.nombre })));
  if (filas.length === 0) return <EstadoVacio>No hay anuncios en las campañas de este filtro.</EstadoVacio>;
  return (
    <Tabla
      encabezados={["Campaña", "Publicación", "Título", "Inversión", "Ingresos", "ROAS", "ACOS", "Aviso"]}
      scroll
    >
      {filas.map((anuncio) => (
        <FilaTabla key={`${anuncio.campana}-${anuncio.clave}`}>
          <CeldaTabla>{anuncio.campana}</CeldaTabla>
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
          <CeldaTabla numerica>{anuncio.gasto}</CeldaTabla>
          <CeldaTabla numerica>{anuncio.ingresos}</CeldaTabla>
          <CeldaTabla numerica>{anuncio.roas}</CeldaTabla>
          <CeldaTabla numerica>{anuncio.acos}</CeldaTabla>
          <CeldaTabla>
            <AvisosAnuncio anuncio={anuncio} />
          </CeldaTabla>
        </FilaTabla>
      ))}
    </Tabla>
  );
}

function FilaGrupo({
  campana,
  abierta,
  comparar,
  panelId,
  onToggle,
}: {
  campana: CampanaPintada;
  abierta: boolean;
  comparar: boolean;
  panelId: string;
  onToggle: () => void;
}) {
  const anuncios = campana.cantidadAnuncios === 1 ? "1 anuncio" : `${campana.cantidadAnuncios} anuncios`;
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
              <span className={styles.pausada}>{anuncios}</span>
              {campana.pausada ? <span className={styles.pausada}>Pausada</span> : null}
              {campana.anunciosSinVenta > 0 ? (
                <span className={styles.alertaFila}>Gasta sin vender · {campana.anunciosSinVenta}</span>
              ) : null}
            </span>
          </button>
        </CeldaTabla>
        <CeldaTabla className={styles.celdaEstado}>
          <span className={styles.diagnostico}>
            {campana.diagnostico.pill ? (
              <Chip estado={campana.diagnostico.tono === "aviso" ? "aviso" : campana.diagnostico.tono}>{campana.diagnostico.pill}</Chip>
            ) : null}
            {campana.diagnostico.detalle ? <span className={styles.frase}>{campana.diagnostico.detalle}</span> : null}
          </span>
        </CeldaTabla>
        <CeldaTabla numerica className={styles.celdaPresupuesto}>
          <span>{campana.presupuesto}</span>
          {campana.presupuestoUsado ? <span className={styles.usado}>{campana.presupuestoUsado}</span> : null}
        </CeldaTabla>
        <CeldaTabla numerica>{campana.roasObjetivo ?? "—"}</CeldaTabla>
        <CeldaNumero valor={campana.ventasPublicidad} delta={comparar ? campana.deltas.ventasAtribuidas : null} />
        <CeldaNumero valor={campana.roas} delta={comparar ? campana.deltas.roas : null} />
        <CeldaNumero valor={campana.acos} delta={comparar ? campana.deltas.acos : null} />
        <CeldaNumero valor={campana.inversion} delta={comparar ? campana.deltas.inversion : null} />
        <CeldaNumero valor={campana.ingresos} delta={comparar ? campana.deltas.ingresos : null} />
        <CeldaNumero valor={campana.clics} delta={comparar ? campana.deltas.clics : null} />
        <CeldaNumero valor={campana.impresiones} delta={comparar ? campana.deltas.impresiones : null} />
      </FilaTabla>
      {abierta ? (
        <FilaTabla id={panelId}>
          <CeldaTabla colSpan={COLUMNAS_CAMPANA}>
            <ul className={styles.extras}>
              <li>
                Ventas sin publicidad: {campana.ventasSinPublicidad}
                <Ayuda id={`ayuda-organicas-${campana.id}`}>{NOTA_VENTAS_ORGANICAS}</Ayuda>
              </li>
              <li>TACOS: {campana.tacos}</li>
              <li>
                Unidades: {campana.unidades}
                <Ayuda id={`ayuda-unidades-${campana.id}`}>{NOTA_UNIDADES}</Ayuda>
              </li>
              <li>Ventas atribuidas (cantidad): {campana.ventasCantidad}</li>
            </ul>
            {campana.anuncios.length === 0 ? (
              <EstadoVacio>Esta campaña no tiene anuncios en la última sincronización.</EstadoVacio>
            ) : (
              <div className={styles.anuncios}>
                <Tabla
                  encabezados={[
                    "Publicación",
                    "Título",
                    "Inversión",
                    "Ingresos",
                    { clave: `sin-${campana.id}`, contenido: <span title="Ventas sin publicidad">Sin publ.</span> },
                    "TACOS",
                    { clave: `unid-${campana.id}`, contenido: <span title="Unidades con publicidad">Unid.</span> },
                    "ROAS",
                    "ACOS",
                    {
                      clave: `aviso-${campana.id}`,
                      contenido: (
                        <span className={styles.thConAyuda}>
                          Aviso
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
                      <CeldaTabla numerica>{anuncio.gasto}</CeldaTabla>
                      <CeldaTabla numerica>{anuncio.ingresos}</CeldaTabla>
                      <CeldaTabla numerica>{anuncio.ventasOrganicas}</CeldaTabla>
                      <CeldaTabla numerica>{anuncio.tacos}</CeldaTabla>
                      <CeldaTabla numerica>{anuncio.unidades}</CeldaTabla>
                      <CeldaTabla numerica>{anuncio.roas}</CeldaTabla>
                      <CeldaTabla numerica>{anuncio.acos}</CeldaTabla>
                      <CeldaTabla>
                        <AvisosAnuncio anuncio={anuncio} />
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

function CeldaNumero({ valor, delta }: { valor: string; delta: DeltaPintado | null }) {
  return (
    <CeldaTabla numerica>
      <span>{valor}</span>
      {delta ? (
        <span className={styles.delta} data-tono={delta.mejor === null ? "neutro" : delta.mejor ? "mejor" : "peor"}>
          {delta.texto}
        </span>
      ) : null}
    </CeldaTabla>
  );
}

function AvisosAnuncio({ anuncio }: { anuncio: CampanaPintada["anuncios"][number] }) {
  const pausado = (anuncio.estadoAnuncio ?? "").toLowerCase() === "paused";
  if (!anuncio.gastaSinVender && anuncio.sinStock !== true && !pausado) return null;
  return (
    <span className={styles.avisos}>
      {anuncio.gastaSinVender ? <span className={styles.alertaFila}>Gasta sin vender</span> : null}
      {anuncio.sinStock === true ? <span className={styles.alertaFila}>Sin stock</span> : null}
      {pausado ? <span className={styles.pausada}>Anuncio pausado</span> : null}
    </span>
  );
}
