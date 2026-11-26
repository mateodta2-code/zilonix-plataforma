"use client";

import Link from "next/link";
import { Fragment, useEffect, useState, useTransition } from "react";
import { Boton } from "@/components/marco/Boton";
import { BarraCarga } from "@/components/marco/BarraCarga";
import { Chip, type EstadoChip } from "@/components/marco/Chip";
import { CeldaTabla, FilaTabla, Tabla } from "@/components/marco/Tabla";
import { formatearMoneda, formatearNumero } from "@/lib/ml/sitios";
import { rotuloCortoPeriodo, type PeriodoLista } from "@/lib/optimizacion/periodoLista";
import { conversion, rotuloCompetencia, rotuloEstadoPublicacion, rotuloTipoPublicacion, tonoCalidad } from "@/lib/optimizacion/textos";
import { cambiarEstadoPublicacionAction, metricasPublicacionesAction, type MetricasPublicacion } from "./actions";
import { DesgloseCompetencia } from "./DesgloseCompetencia";
import styles from "./page.module.css";
import { SkuCopiable } from "@/components/marco/SkuCopiable";

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
const MAXIMO_CHIPS = 2;

// Color del nivel de experiencia tal cual lo da Mercado Libre.
function tonoExperiencia(color: string | null): EstadoChip {
  const c = (color ?? "").toLowerCase();
  if (c === "green") return "exito";
  if (c === "red") return "peligro";
  if (c === "orange" || c === "yellow") return "advertencia";
  return "neutro";
}

function encabezados(periodo: PeriodoLista) {
  const corto = rotuloCortoPeriodo(periodo);
  return [
    "",
    "Publicación",
    { clave: "precio", contenido: "Precio", numerica: true },
    "Tipo",
    "Envío",
    { clave: "visitas", contenido: `Visitas ${corto}`, numerica: true },
    { clave: "ventas", contenido: `Ventas ${corto}`, numerica: true },
    { clave: "conversion", contenido: "Conversión", numerica: true },
    "Calidad",
    "Competencia",
    "Experiencia",
    "Estado",
    "Recomendaciones",
  ];
}

export function TablaOptimizacion({
  filas,
  cuentaMlId,
  siteId,
  idioma,
  puedeModificar,
  periodo,
  paraRevisar = [],
  periodoParams = {},
}: {
  filas: FilaTablaOptimizacion[];
  cuentaMlId: string;
  siteId: string;
  idioma: string;
  puedeModificar: boolean;
  periodo: PeriodoLista;
  // Publicaciones con un cambio que ya cumplió 7 días (bitácora).
  paraRevisar?: string[];
  // Parámetros de URL del período, para mantenerlos en el enlace al detalle.
  periodoParams?: Record<string, string>;
}) {
  const [metricas, setMetricas] = useState<Record<string, MetricasPublicacion>>({});
  const [cargando, setCargando] = useState(true);
  const [procesadas, setProcesadas] = useState(0);
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
    setProcesadas(0);
    setAvisoMetricas(null);
    (async () => {
      for (let i = 0; i < filas.length; i += LOTE) {
        if (cancelado) return;
        const lote = filas.slice(i, i + LOTE).map((f) => ({ id: f.id, catalogo: f.catalogo }));
        try {
          const r = await metricasPublicacionesAction({
            cuentaMlId,
            items: lote,
            // Hoy y rango van con fechas; los 7/14/30/90 de siempre, con días.
            ...(periodo.clave === "hoy" || periodo.clave === "rango" ? { periodo: { desde: periodo.desde, hasta: periodo.hasta } } : { dias: periodo.dias }),
          });
          if (cancelado) return;
          if (!r.ok) {
            setAvisoMetricas(r.aviso);
            break;
          }
          setMetricas((previas) => ({ ...previas, ...r.metricas }));
          setProcesadas(Math.min(i + LOTE, filas.length));
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
  }, [filas, cuentaMlId, periodo.clave, periodo.desde, periodo.hasta, periodo.dias]);

  const sufijoDetalle = `?${new URLSearchParams({ cuenta: cuentaMlId, ...periodoParams }).toString()}`;
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
      {/* Avance real por tandas; si se corta, queda «detenida» con el aviso y sin «Seguir» (no hay forma de reanudar sin recargar). */}
      <BarraCarga
        estado={cargando ? "cargando" : avisoMetricas ? "detenida" : "completa"}
        titulo="Trayendo visitas, calidad y competencia…"
        avance={{ hechos: procesadas, total: filas.length }}
        unidad="publicaciones"
        textoCompleta="Datos completos"
        textoDetenida={avisoMetricas ?? undefined}
        ariaLabel="Progreso de visitas, calidad y competencia"
        sticky={false}
      />
      <Tabla encabezados={encabezados(periodo)} scroll>
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
                      <span className={styles.notaNeutra}>{fila.id} · {fila.sku ? <SkuCopiable sku={fila.sku} prefijo="SKU " /> : "Sin SKU"}</span>
                      <Link className={styles.verDetalle} href={`/panel/optimizacion/${fila.id}${sufijoDetalle}`}>
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
                        {m.calidad.pendientes.length === 0
                          ? "Sin objetivos"
                          : `${m.calidad.pendientes.length} ${m.calidad.pendientes.length === 1 ? "objetivo pendiente" : "objetivos pendientes"}`}
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
                  {m === undefined ? (
                    pendiente("—")
                  ) : m.experiencia && (m.experiencia.texto || m.experiencia.color) ? (
                    <Chip estado={tonoExperiencia(m.experiencia.color)}>{m.experiencia.texto ?? "—"}</Chip>
                  ) : (
                    "—"
                  )}
                </CeldaTabla>
                <CeldaTabla>
                  <span className={styles.estado}>
                    <span>{rotuloEstadoPublicacion(estado)}</span>
                    {puedeModificar && (estado === "active" || estado === "paused") ? (
                      <Boton
                        type="button"
                        variante="primario"
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
                <CeldaTabla>
                  {m === undefined ? (
                    pendiente("—")
                  ) : m.recomendaciones.length === 0 ? (
                    <span className={styles.notaNeutra}>Sin acciones</span>
                  ) : (
                    <span className={styles.chips}>
                      {m.recomendaciones.slice(0, MAXIMO_CHIPS).map((r) => (
                        <Chip key={r.clave} estado="aviso">
                          {r.texto}
                        </Chip>
                      ))}
                      {m.recomendaciones.length > MAXIMO_CHIPS ? (
                        <Link className={styles.verDetalle} href={`/panel/optimizacion/${fila.id}${sufijoDetalle}`}>
                          {`+${m.recomendaciones.length - MAXIMO_CHIPS}`}
                        </Link>
                      ) : null}
                    </span>
                  )}
                </CeldaTabla>
              </FilaTabla>
              {abiertaEsta ? (
                <FilaTabla id={`desglose-${fila.id}`}>
                  <CeldaTabla colSpan={encabezados(periodo).length}>
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
      {periodo.clave === "hoy" ? <p className={styles.nota}>Las visitas de hoy pueden tardar unas horas en aparecer en Mercado Libre.</p> : null}
    </>
  );
}
