"use client";

import Link from "next/link";
import { Fragment, useEffect, useState, useTransition } from "react";
import { Boton } from "@/components/marco/Boton";
import { Chip } from "@/components/marco/Chip";
import { CeldaTabla, FilaTabla, Tabla } from "@/components/marco/Tabla";
import { formatearMoneda, formatearNumero } from "@/lib/ml/sitios";
import { conversion, rotuloCompetencia, rotuloEstadoPublicacion, rotuloTipoPublicacion, tonoCalidad } from "@/lib/optimizacion/textos";
import { cambiarEstadoPublicacionAction, metricasPublicacionesAction, type MetricasPublicacion } from "./actions";
import { DesgloseCompetencia } from "./DesgloseCompetencia";
import styles from "./page.module.css";

export type FilaTablaOptimizacion = {
  id: string;
  titulo: string | null;
  foto: string | null;
  enlace: string | null;
  estado: string | null;
  precio: number | null;
  precioOriginal: number | null;
  tipoPublicacion: string | null;
  envioGratis: boolean | null;
  full: boolean | null;
  catalogo: boolean;
  sku: string | null;
  ventas: { ventas: number; unidades: number } | null;
};

const LOTE = 10;

function encabezados(dias: number) {
  return [
    "",
    "Publicación",
    { clave: "precio", contenido: "Precio", numerica: true },
    "Tipo",
    "Envío",
    { clave: "visitas", contenido: `Visitas ${dias} d`, numerica: true },
    { clave: "ventas", contenido: `Ventas ${dias} d`, numerica: true },
    { clave: "conversion", contenido: "Conversión", numerica: true },
    "Calidad",
    "Competencia",
    "Estado",
  ];
}

export function TablaOptimizacion({
  filas,
  cuentaMlId,
  siteId,
  idioma,
  puedeModificar,
  dias,
  paraRevisar = [],
}: {
  filas: FilaTablaOptimizacion[];
  cuentaMlId: string;
  siteId: string;
  idioma: string;
  puedeModificar: boolean;
  dias: number;
  // Publicaciones con un cambio que ya cumplió 7 días (bitácora).
  paraRevisar?: string[];
}) {
  const [metricas, setMetricas] = useState<Record<string, MetricasPublicacion>>({});
  const [cargando, setCargando] = useState(true);
  const [avisoMetricas, setAvisoMetricas] = useState<string | null>(null);
  const [abierta, setAbierta] = useState<string | null>(null);
  const [estados, setEstados] = useState<Record<string, string>>({});
  const [avisos, setAvisos] = useState<Record<string, { ok: boolean; texto: string }>>({});
  const [cambiando, iniciarCambio] = useTransition();
  const [itemCambiando, setItemCambiando] = useState<string | null>(null);

  // Visitas, calidad y competencia: una llamada por publicación, de a 10.
  // Se cancela si cambia la página antes de terminar.
  useEffect(() => {
    let cancelado = false;
    setMetricas({});
    setCargando(true);
    setAvisoMetricas(null);
    (async () => {
      for (let i = 0; i < filas.length; i += LOTE) {
        if (cancelado) return;
        const lote = filas.slice(i, i + LOTE).map((f) => ({ id: f.id, catalogo: f.catalogo }));
        try {
          const r = await metricasPublicacionesAction({ cuentaMlId, items: lote, dias });
          if (cancelado) return;
          if (!r.ok) {
            setAvisoMetricas(r.aviso);
            break;
          }
          setMetricas((previas) => ({ ...previas, ...r.metricas }));
        } catch {
          if (!cancelado) setAvisoMetricas("No se pudieron traer visitas, calidad y competencia. Actualiza la página para reintentar.");
          break;
        }
      }
      if (!cancelado) setCargando(false);
    })();
    return () => {
      cancelado = true;
    };
  }, [filas, cuentaMlId, dias]);

  const plata = (valor: number | null) => (valor === null ? "—" : formatearMoneda(valor, siteId));

  function cambiarEstado(fila: FilaTablaOptimizacion, activar: boolean) {
    setItemCambiando(fila.id);
    iniciarCambio(async () => {
      const r = await cambiarEstadoPublicacionAction({ cuentaMlId, itemId: fila.id, activar });
      setAvisos((previos) => ({ ...previos, [fila.id]: { ok: r.ok, texto: r.aviso } }));
      if (r.ok && r.estado) setEstados((previos) => ({ ...previos, [fila.id]: r.estado as string }));
      setItemCambiando(null);
    });
  }

  return (
    <>
      {avisoMetricas ? <p className={styles.avisoError}>{avisoMetricas}</p> : null}
      {cargando ? <p className={styles.nota}>Trayendo visitas, calidad y competencia de Mercado Libre…</p> : null}
      <Tabla encabezados={encabezados(dias)} scroll>
        {filas.map((fila) => {
          const m = metricas[fila.id];
          const visitas = m ? m.visitas : undefined;
          const estado = estados[fila.id] ?? fila.estado;
          const competencia = rotuloCompetencia(m?.competencia?.estado ?? null);
          const abiertaEsta = abierta === fila.id;
          const pendiente = (texto: string) => (m === undefined && cargando ? "…" : texto);
          return (
            <Fragment key={fila.id}>
              <FilaTabla>
                <CeldaTabla>
                  <button
                    type="button"
                    className={styles.expandir}
                    aria-expanded={abiertaEsta}
                    aria-controls={`desglose-${fila.id}`}
                    aria-label={abiertaEsta ? "Cerrar desglose" : "Abrir desglose"}
                    onClick={() => setAbierta(abiertaEsta ? null : fila.id)}
                  >
                    {abiertaEsta ? "▾" : "▸"}
                  </button>
                </CeldaTabla>
                <CeldaTabla>
                  <div className={styles.publicacion}>
                    {fila.foto ? <img className={styles.foto} src={fila.foto} alt="" width={48} height={48} loading="lazy" /> : <span className={styles.foto} />}
                    <div>
                      {fila.enlace ? (
                        <a href={fila.enlace} target="_blank" rel="noopener noreferrer" className={styles.enlace}>
                          {fila.titulo ?? fila.id}
                        </a>
                      ) : (
                        <span>{fila.titulo ?? fila.id}</span>
                      )}
                      <span className={styles.notaNeutra}>{[fila.id, fila.sku ? `SKU ${fila.sku}` : "Sin SKU"].join(" · ")}</span>
                      <Link className={styles.verDetalle} href={`/panel/optimizacion/${fila.id}?cuenta=${cuentaMlId}`}>
                        Ver detalle →
                      </Link>
                      {paraRevisar.includes(fila.id) ? (
                        <Link href={`/panel/optimizacion/${fila.id}?cuenta=${cuentaMlId}#bitacora`} className={styles.chipRevisar} title="Un cambio de esta publicación ya cumplió 7 días: revisa en la bitácora si funcionó.">
                          Revisar cambio
                        </Link>
                      ) : null}
                    </div>
                  </div>
                </CeldaTabla>
                <CeldaTabla numerica>
                  {plata(fila.precio)}
                  {fila.precioOriginal !== null ? <span className={styles.precioAntes}>{plata(fila.precioOriginal)}</span> : null}
                </CeldaTabla>
                <CeldaTabla>{rotuloTipoPublicacion(fila.tipoPublicacion)}</CeldaTabla>
                <CeldaTabla>
                  <span className={styles.chips}>
                    {fila.envioGratis ? <Chip estado="aviso">Gratis</Chip> : null}
                    {fila.full ? <Chip estado="exito">Full</Chip> : null}
                    {!fila.envioGratis && !fila.full ? "—" : null}
                  </span>
                </CeldaTabla>
                <CeldaTabla numerica>{visitas === undefined ? pendiente("—") : visitas === null ? "—" : formatearNumero(visitas, idioma)}</CeldaTabla>
                <CeldaTabla numerica>
                  {fila.ventas ? formatearNumero(fila.ventas.ventas, idioma) : "—"}
                  {fila.ventas && fila.ventas.unidades !== fila.ventas.ventas ? (
                    <span className={styles.notaNeutra}>{`${formatearNumero(fila.ventas.unidades, idioma)} u.`}</span>
                  ) : null}
                </CeldaTabla>
                <CeldaTabla numerica>{visitas === undefined ? pendiente("—") : (conversion(fila.ventas?.ventas ?? null, visitas) ?? "—")}</CeldaTabla>
                <CeldaTabla>
                  {m === undefined ? (
                    pendiente("—")
                  ) : m.calidad && m.calidad.puntaje !== null ? (
                    <span className={styles.calidad}>
                      <Chip estado={tonoCalidad(m.calidad.puntaje)} title={m.calidad.nivel ?? undefined}>
                        {m.calidad.puntaje}
                      </Chip>
                      <span className={styles.notaNeutra}>
                        {m.calidad.pendientes.length === 0 ? "Sin objetivos" : `${m.calidad.pendientes.length} ${m.calidad.pendientes.length === 1 ? "objetivo" : "objetivos"}`}
                      </span>
                    </span>
                  ) : (
                    "—"
                  )}
                </CeldaTabla>
                <CeldaTabla>
                  {!fila.catalogo ? (
                    <span className={styles.notaNeutra}>No es de catálogo</span>
                  ) : m === undefined ? (
                    pendiente("—")
                  ) : (
                    <Chip estado={competencia.tono}>{competencia.rotulo}</Chip>
                  )}
                </CeldaTabla>
                <CeldaTabla>
                  <span className={styles.estado}>
                    <span>{rotuloEstadoPublicacion(estado)}</span>
                    {puedeModificar && (estado === "active" || estado === "paused") ? (
                      <Boton
                        type="button"
                        variante="secundario"
                        chico
                        disabled={cambiando && itemCambiando === fila.id}
                        onClick={() => cambiarEstado(fila, estado === "paused")}
                      >
                        {cambiando && itemCambiando === fila.id ? "…" : estado === "paused" ? "Activar" : "Pausar"}
                      </Boton>
                    ) : null}
                  </span>
                  {avisos[fila.id] ? (
                    <span className={avisos[fila.id].ok ? styles.avisoOk : styles.avisoError} role="status">
                      {avisos[fila.id].texto}
                    </span>
                  ) : null}
                </CeldaTabla>
              </FilaTabla>
              {abiertaEsta ? (
                <FilaTabla id={`desglose-${fila.id}`}>
                  <CeldaTabla colSpan={encabezados(dias).length}>
                    <div className={styles.desglose}>
                      <p className={styles.seccion}>Competencia del mismo producto</p>
                      <DesgloseCompetencia
                        cuentaMlId={cuentaMlId}
                        itemId={fila.id}
                        siteId={siteId}
                        idioma={idioma}
                        propia={{
                          itemId: fila.id,
                          titulo: fila.titulo,
                          foto: fila.foto,
                          enlace: fila.enlace,
                          precio: fila.precio,
                          precioOriginal: fila.precioOriginal,
                          envioGratis: fila.envioGratis,
                          full: fila.full,
                        }}
                      />
                      {m?.calidad && m.calidad.pendientes.length > 0 ? (
                        <>
                          <p className={styles.seccion}>Objetivos de calidad pendientes</p>
                          <ul className={styles.objetivos}>
                            {m.calidad.pendientes.map((objetivo) => (
                              <li key={objetivo}>{objetivo}</li>
                            ))}
                          </ul>
                        </>
                      ) : null}
                    </div>
                  </CeldaTabla>
                </FilaTabla>
              ) : null}
            </Fragment>
          );
        })}
      </Tabla>
    </>
  );
}
