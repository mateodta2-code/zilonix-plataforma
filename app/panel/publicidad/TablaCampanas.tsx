"use client";

import { useState } from "react";
import { Chip } from "@/components/marco/Chip";
import { Ayuda } from "@/components/marco/Ayuda";
import { CeldaTabla, FilaTabla, Tabla, type EncabezadoTabla } from "@/components/marco/Tabla";
import { EstadoVacio } from "@/components/marco/EstadoVacio";
import { AYUDA_SEMAFORO, COLUMNAS_CAMPANA, NOTA_UNIDADES, NOTA_VENTAS_ORGANICAS } from "@/lib/publicidad/rotulos";
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

export function TablaAnuncios({ campanas }: { campanas: CampanaPintada[] }) {
  const filas = campanas.flatMap((campana) => campana.anuncios.map((anuncio) => ({ ...anuncio, campana: campana.nombre })));
  if (filas.length === 0) return <EstadoVacio>No hay anuncios en las campañas de este filtro.</EstadoVacio>;
  return (
    <Tabla
      encabezados={[
        "Campaña",
        "Publicación",
        "Título",
        num("inversion", "Inversión"),
        num("ingresos", "Ingresos"),
        num("roas", "ROAS"),
        num("acos", "ACOS"),
        num("margen", "Margen"),
        "Aviso",
      ]}
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
          <CeldaTabla numerica>
            <CeldaMargen anuncio={anuncio} />
          </CeldaTabla>
          <CeldaTabla>
            <AvisosAnuncio anuncio={anuncio} />
          </CeldaTabla>
        </FilaTabla>
      ))}
    </Tabla>
  );
}

// Semáforo de productos: margen de ganancia real contra la meta.
function CeldaMargen({ anuncio }: { anuncio: Pick<CampanaPintada["anuncios"][number], "margen" | "margenTono" | "margenTitulo"> }) {
  return (
    <Chip estado={anuncio.margenTono} title={anuncio.margenTitulo}>
      {anuncio.margen}
    </Chip>
  );
}

// Título de una columna de números: a la derecha, encima de su valor.
function num(clave: string, contenido: React.ReactNode): EncabezadoTabla {
  return { clave, contenido, numerica: true };
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
            <span className={styles.nombreCampana} title={campana.nombre}>
              {campana.nombre}
            </span>
          </button>
        </CeldaTabla>
        <CeldaTabla>
          <Chip estado={campana.semaforo.tono} title={campana.semaforo.porcentaje ? `${campana.semaforo.porcentaje} del objetivo` : undefined}>
            {campana.semaforo.rotulo}
          </Chip>
        </CeldaTabla>
        <CeldaTabla>
          <span className={styles.frase}>{campana.diagnosticoTexto}</span>
        </CeldaTabla>
        <CeldaTabla numerica>{campana.cantidadAnuncios}</CeldaTabla>
        <CeldaTabla numerica>
          <strong>{campana.roas}</strong>
          {campana.roasObjetivoCorto ? <span className={styles.motivo}> / {campana.roasObjetivoCorto}</span> : null}
        </CeldaTabla>
        <CeldaTabla numerica>{campana.acos}</CeldaTabla>
        <CeldaTabla numerica>{campana.ventasCantidad}</CeldaTabla>
        <CeldaTabla numerica>{campana.inversion}</CeldaTabla>
        <CeldaTabla numerica>{campana.ventasPublicidad}</CeldaTabla>
        <CeldaTabla numerica>{campana.presupuesto}</CeldaTabla>
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
                    num(`inv-${campana.id}`, "Inversión"),
                    num(`ing-${campana.id}`, "Ingresos"),
                    num(`sin-${campana.id}`, <span title="Ventas sin publicidad">Sin publ.</span>),
                    num(`tacos-${campana.id}`, "TACOS"),
                    num(`unid-${campana.id}`, <span title="Unidades con publicidad">Unid.</span>),
                    num(`roas-${campana.id}`, "ROAS"),
                    num(`acos-${campana.id}`, "ACOS"),
                    num(`margen-${campana.id}`, "Margen"),
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
                      <CeldaTabla numerica>
                        <CeldaMargen anuncio={anuncio} />
                      </CeldaTabla>
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

function AvisosAnuncio({ anuncio }: { anuncio: CampanaPintada["anuncios"][number] }) {
  const pausado = (anuncio.estadoAnuncio ?? "").toLowerCase() === "paused";
  if (!anuncio.sugerencia && !anuncio.gastaSinVender && !anuncio.nota && anuncio.sinStock !== true && !pausado) return null;
  return (
    <span className={styles.avisos}>
      {anuncio.sugerencia ? (
        <span className={styles.alertaFila}>{anuncio.sugerencia}</span>
      ) : anuncio.gastaSinVender ? (
        <span className={styles.alertaFila}>Gasta sin vender</span>
      ) : null}
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
  if (
    codigo === "aprendizaje" ||
    codigo === "dejar_igual" ||
    codigo === "vigilar" ||
    codigo === "nota_vende_bien" ||
    codigo === "nota_vende_antartida"
  ) {
    return "neutro";
  }
  if (codigo === "renombrar_vendedor") return "acento";
  if (codigo === "campana_repetida") return "peligro";
  return "peligro";
}
