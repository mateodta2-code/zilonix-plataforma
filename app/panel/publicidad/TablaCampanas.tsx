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
              {campana.mayorGasto.map((ad) => (
                <span key={ad.id} className={styles.mayorGasto} title={`${ad.nombre}. Inversión ${ad.inversion}. ${ad.parte ?? "—"} del gasto. Ventas ${ad.ventas}.`}>
                  Mayor gasto: {ad.nombre} · {ad.inversion} · {ad.parte ?? "—"} · ventas {ad.ventas}
                </span>
              ))}
              {campana.textoEnfriamiento ? <span className={styles.alertaFila}>{campana.textoEnfriamiento}</span> : null}
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
            <ListaRecomendaciones titulo="Recomendaciones" items={campana.recomendaciones} />
            {campana.mayorGasto.length > 0 ? (
              <ul className={styles.extras}>
                {campana.mayorGasto.map((ad) => (
                  <li key={ad.id}>
                    Mayor gasto: {ad.nombre}. Inversión {ad.inversion}
                    {ad.parte ? ` (${ad.parte} del gasto de la campaña)` : ""}. Ventas {ad.ventas}.
                  </li>
                ))}
              </ul>
            ) : null}
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
                      <CeldaTabla>
                        {anuncio.mayorGasto ? <span className={styles.marcaMayor}>Mayor gasto</span> : null}
                        {anuncio.titulo}
                      </CeldaTabla>
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
  if (!anuncio.sugerencia && !anuncio.nota && anuncio.sinStock !== true && !pausado) return null;
  return (
    <span className={styles.avisos}>
      {anuncio.sugerencia ? <span className={styles.alertaFila}>{anuncio.sugerencia}</span> : null}
      {anuncio.nota ? <span className={styles.notaNeutra}>{anuncio.nota}</span> : null}
      {anuncio.sinStock === true ? <span className={styles.alertaFila}>Sin stock</span> : null}
      {pausado ? <span className={styles.pausada}>Anuncio pausado</span> : null}
    </span>
  );
}

export function ResumenRecomendaciones({ campanas }: { campanas: CampanaPintada[] }) {
  const conAlgo = campanas.filter((campana) => campana.recomendaciones.length > 0);
  return (
    <section className={styles.recomendaciones} aria-label="Recomendaciones">
      <p className={styles.seccion}>Recomendaciones</p>
      {conAlgo.length === 0 ? (
        <p className={styles.nota}>Ninguna campaña de este filtro tiene una recomendación.</p>
      ) : (
        <ul className={styles.listaRecomendaciones}>
          {conAlgo.map((campana) => (
            <li key={campana.id}>
              <span className={styles.nombreResumen}>{campana.nombre}</span>
              <ListaRecomendaciones items={campana.recomendaciones} />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function ListaRecomendaciones({ titulo, items }: { titulo?: string; items: CampanaPintada["recomendaciones"] }) {
  if (items.length === 0) return null;
  return (
    <div className={styles.bloqueRecomendacion}>
      {titulo ? <p className={styles.seccion}>{titulo}</p> : null}
      <ul className={styles.listaRecomendaciones}>
        {items.map((item) => (
          <li key={`${item.codigo}-${item.anuncioId ?? "campana"}`} data-tono={tonoRecomendacion(item.codigo)}>
            {item.nombre ? <span className={styles.nombreResumen}>{item.nombre}. </span> : null}
            <span>{item.texto}</span>
            <span className={styles.motivo}> {item.motivo}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function tonoRecomendacion(codigo: CampanaPintada["recomendaciones"][number]["codigo"]): "peligro" | "acento" | "neutro" {
  if (codigo === "nota_vende_bien" || codigo === "aprendizaje") return "neutro";
  if (codigo === "subir_objetivo") return "acento";
  return "peligro";
}
