"use client";

import { Fragment, useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { BarraCarga } from "@/components/marco/BarraCarga";
import { Boton } from "@/components/marco/Boton";
import { CeldaTabla, FilaTabla, Tabla } from "@/components/marco/Tabla";
import { Tarjeta } from "@/components/marco/Tarjeta";
import { Chip } from "@/components/marco/Chip";
import { EstadoVacio } from "@/components/marco/EstadoVacio";
import type { Cuenta } from "./CuentasDestino";
import { FilaFalabella, useHistorialFalabella, type PublicacionFalabella } from "./HistorialFalabella";
import { ErrorPublicacion } from "./ErrorPublicacion";
import { borrarProductoAction } from "./actions";
import {
  detalleCuentasProducto,
  enlacesPermalink,
  formatearFechaBogota,
  resumenEstadoProducto,
  type FilaDetalleCuenta,
  type FilaProductoParaCargar,
} from "./formulario-logica";
import { formatearMoneda, SITE_ID_DEFECTO } from "@/lib/ml/sitios";
import { etiquetaEstadoItemMl, etiquetaPublicacionCuenta, etiquetaSubStatusItemMl } from "@/lib/ml/estado-publicacion";

const CANTIDAD_COLUMNAS = 6; // Título, Precio, Estado, "", Fecha, Acciones — ancho del <td colSpan> del detalle desplegado.

export type ProductoHistorial = FilaProductoParaCargar & {
  id: string;
  titulo: string | null;
  estado: string;
  creadoTs: string;
};

// Barra-A — intervalo del sondeo de avance y tope de seguridad: pasado el
// tope se deja de consultar (la fila colgada la limpia
// marcarPublicacionesColgadas, no este sondeo).
export const INTERVALO_SONDEO_MS = 4500;
export const TOPE_SONDEO_MS = 10 * 60_000;

type Avance = { hechos: number; total: number };
type Terminada = { id: string; titulo: string; hechos: number; total: number };

// Barra azul con el avance real "N de M cuentas" de cada publicación en
// curso. Escala (>1000 usuarios): NO hay ninguna petición si no hay
// publicaciones en "publicando" ni con la pestaña oculta; cada consulta
// pide solo { estado, hechos, total } de UNA publicación.
function BandasPublicando({ productos }: { productos: ProductoHistorial[] }) {
  const router = useRouter();
  // Ref: el efecto del sondeo no debe reiniciarse si cambia la identidad del router.
  const routerRef = useRef(router);
  routerRef.current = router;
  const enCurso = productos.filter((p) => p.estado === "publicando");
  const clave = enCurso.map((p) => p.id).join(",");
  const [avances, setAvances] = useState<Record<string, Avance>>({});
  const [terminadas, setTerminadas] = useState<Terminada[]>([]);
  const inicioRef = useRef<number | null>(null);
  const titulosRef = useRef<Record<string, string>>({});
  titulosRef.current = Object.fromEntries(productos.map((p) => [p.id, p.titulo || "(sin título)"]));

  const consultar = useCallback(async (ids: string[]) => {
    const terminadasAhora: Terminada[] = [];
    await Promise.all(
      ids.map(async (id) => {
        try {
          const resp = await fetch(`/api/ml/publicar/estado-publicacion?id=${encodeURIComponent(id)}`);
          if (!resp.ok) return;
          const d = (await resp.json()) as { estado?: string; hechos?: number; total?: number };
          if (typeof d.hechos !== "number" || typeof d.total !== "number") return;
          if (d.estado && d.estado !== "publicando") {
            terminadasAhora.push({ id, titulo: titulosRef.current[id] ?? "(sin título)", hechos: d.hechos, total: d.total });
          } else {
            setAvances((a) => ({ ...a, [id]: { hechos: d.hechos as number, total: d.total as number } }));
          }
        } catch {
          // Error de red: se reintenta en el próximo ciclo.
        }
      })
    );
    if (terminadasAhora.length > 0) {
      const ids = new Set(terminadasAhora.map((t) => t.id));
      setTerminadas((t) => [...t.filter((x) => !ids.has(x.id)), ...terminadasAhora]);
      setAvances((a) => Object.fromEntries(Object.entries(a).filter(([id]) => !ids.has(id))));
      routerRef.current.refresh(); // una sola vez por tanda: trae la fila final.
    }
  }, []);

  useEffect(() => {
    if (!clave) {
      inicioRef.current = null;
      return;
    }
    const ids = clave.split(",");
    if (inicioRef.current === null) inicioRef.current = Date.now();
    let intervalo: ReturnType<typeof setInterval> | null = null;
    let enVuelo = false;

    const ciclo = async () => {
      if (enVuelo) return;
      if (Date.now() - (inicioRef.current ?? Date.now()) > TOPE_SONDEO_MS) {
        detener();
        return;
      }
      enVuelo = true;
      try {
        await consultar(ids);
      } finally {
        enVuelo = false;
      }
    };
    const detener = () => {
      if (intervalo) clearInterval(intervalo);
      intervalo = null;
    };
    const arrancar = () => {
      if (intervalo || document.visibilityState === "hidden") return;
      void ciclo();
      intervalo = setInterval(() => void ciclo(), INTERVALO_SONDEO_MS);
    };
    const alCambiarVisibilidad = () => (document.visibilityState === "hidden" ? detener() : arrancar());

    arrancar();
    document.addEventListener("visibilitychange", alCambiarVisibilidad);
    return () => {
      detener();
      document.removeEventListener("visibilitychange", alCambiarVisibilidad);
    };
  }, [clave, consultar]);

  if (enCurso.length === 0 && terminadas.length === 0) return null;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 12 }}>
      {enCurso.map((p) => {
        const a = avances[p.id] ?? { hechos: p.resultado?.length ?? 0, total: p.cuentasSeleccionadas.length };
        return (
          <BarraCarga
            key={p.id}
            estado="cargando"
            sticky={false}
            titulo={`Publicando «${p.titulo || "(sin título)"}»…`}
            avance={a.total > 0 ? a : null}
            unidad="cuentas"
            ariaLabel={`Avance de la publicación de ${p.titulo || "(sin título)"}`}
          />
        );
      })}
      {terminadas.map((t) => {
        const fila = productos.find((p) => p.id === t.id);
        const resumen = fila && fila.estado !== "publicando" ? resumenEstadoProducto(fila.resultado) : null;
        const exitosas = resumen ? resumen.ok : t.hechos;
        return (
          <BarraCarga
            key={`fin-${t.id}`}
            estado="completa"
            sticky={false}
            titulo={t.titulo}
            textoCompleta={`Publicación terminada · ${exitosas} de ${t.total} cuentas exitosas`}
            duracionCompletaMs={4000}
            ariaLabel={`Publicación de ${t.titulo} terminada`}
          />
        );
      })}
    </div>
  );
}

const ETIQUETA_ESTADO: Record<string, string> = {
  borrador: "Borrador",
  publicando: "Publicando…",
  publicado: "Publicado",
  con_errores: "Con errores",
};

// Issue #315 — el precio de la fila se formatea en la moneda real de
// la primera cuenta seleccionada (todas las cuentas de una misma fila
// comparten precio, nunca varias monedas a la vez); sin cuenta que
// matchee (cuenta ya desconectada/borrada), cae al default documentado
// en lib/ml/sitios.ts, nunca "$"/es-CO fijo.
function siteIdDeFila(cuentasSeleccionadas: string[], cuentas: Cuenta[]): string {
  const cuenta = cuentas.find((c) => c.id === cuentasSeleccionadas[0]);
  return cuenta?.siteId ?? SITE_ID_DEFECTO;
}

function EstadoCelda({ producto }: { producto: ProductoHistorial }) {
  // Con el resultado parcial por cuenta (Barra-A), mientras se publica el
  // chip no puede mostrar un ✅ N/M a medias: el avance va en la barra.
  const resumen = producto.estado === "publicando" ? null : resumenEstadoProducto(producto.resultado);
  if (!resumen) return <Chip>{ETIQUETA_ESTADO[producto.estado] ?? producto.estado}</Chip>;
  const estadoChip = resumen.icono === "✅" ? "exito" : resumen.icono === "❌" ? "peligro" : "aviso";
  return (
    <Chip estado={estadoChip}>
      {resumen.icono} {resumen.ok}/{resumen.total}
    </Chip>
  );
}

type EstadoRealCuenta = { cargando: boolean; status: string | null; subStatus: string | null; error: string | null };

// Issue "historial de Publicar — detalle en español, in-place" — una
// cuenta por línea, dentro del <td colSpan> desplegado. `etiquetaPublicacionCuenta`
// distingue "Publicado (sin verificar)" (status guardado al publicar,
// nunca confirmado de nuevo) de "Publicado y activo" (después de
// apretar "Ver estado real") — mismo criterio que zilonix-os-web.
// `fila.statusGuardado` se muestra como dato de referencia MIENTRAS no
// se verificó (nunca reemplaza al estado real: pudo cambiar después,
// directo en Mercado Libre — ese es justamente el motivo de este
// botón).
function DetalleCuentaFila({ fila }: { fila: FilaDetalleCuenta }) {
  const [estadoReal, setEstadoReal] = useState<EstadoRealCuenta>({ cargando: false, status: null, subStatus: null, error: null });

  async function verEstadoReal() {
    if (!fila.itemId) return;
    setEstadoReal({ cargando: true, status: null, subStatus: null, error: null });
    try {
      const params = new URLSearchParams({ cuentaId: fila.cuentaMlId, itemId: fila.itemId });
      const resp = await fetch(`/api/ml/publicar/estado-item?${params.toString()}`);
      const datos = (await resp.json().catch(() => null)) as { status?: unknown; subStatus?: unknown; error?: unknown } | null;
      if (!resp.ok || !datos) {
        setEstadoReal({ cargando: false, status: null, subStatus: null, error: typeof datos?.error === "string" ? datos.error : "No se pudo consultar el estado real." });
        return;
      }
      setEstadoReal({
        cargando: false,
        status: typeof datos.status === "string" ? datos.status : null,
        subStatus: typeof datos.subStatus === "string" ? datos.subStatus : null,
        error: null,
      });
    } catch {
      setEstadoReal({ cargando: false, status: null, subStatus: null, error: "No se pudo consultar el estado real — revisa tu conexión." });
    }
  }

  const etiquetaSubStatus = etiquetaSubStatusItemMl(estadoReal.subStatus);

  return (
    <li style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 8, padding: "6px 0", borderBottom: "1px solid var(--borde)", fontSize: 13 }}>
      <strong>{fila.nickname}</strong>
      {fila.subEtiqueta && <span style={{ opacity: 0.7 }}>({fila.subEtiqueta})</span>}
      {fila.error ? (
        <ErrorPublicacion error={fila.error} />
      ) : (
        <>
          <span>{etiquetaPublicacionCuenta(estadoReal.status)}</span>
          {estadoReal.status === null && fila.statusGuardado && (
            <span style={{ opacity: 0.6, fontSize: 12 }}>(guardado: {etiquetaEstadoItemMl(fila.statusGuardado)})</span>
          )}
          {etiquetaSubStatus && <span style={{ opacity: 0.7, fontSize: 12 }}>· {etiquetaSubStatus}</span>}
          {fila.permalink && (
            <a href={fila.permalink} target="_blank" rel="noreferrer">
              Ver publicación ↗
            </a>
          )}
          {fila.itemId && (
            <Boton type="button" variante="fantasma" onClick={verEstadoReal} disabled={estadoReal.cargando}>
              {estadoReal.cargando ? "Consultando…" : "Ver estado real"}
            </Boton>
          )}
          {estadoReal.error && <span style={{ color: "var(--peligro-texto)" }}>{estadoReal.error}</span>}
        </>
      )}
    </li>
  );
}

// Punto 8 del pedido — "Productos publicados recientemente en la
// misma página" con Título/Precio/Estado/"ver detalle"/Fecha y los 3
// botones (Cargar/Reintentar, Duplicar, Borrar).
//
// Feedback real de Mateo (este issue) — "ver detalle" NUNCA navega a
// otra página: despliega EN LA MISMA FILA una línea por cuenta (toggle
// con "ocultar"), igual que la tabla equivalente de Zilonix OS
// (components/negocio/MercadoLibrePublicar.js). /panel/publicar/[id]
// sigue existiendo sin cambios para quien tenga ese link viejo
// guardado, pero el historial ya no enlaza ahí. Borrar pide
// confirmación real (nunca silenciosa) y aclara "no borra nada en
// Mercado Libre" — el mensaje exacto que pidió Mateo, para que nadie
// piense que también pausa/elimina la publicación real.
export function HistorialPublicaciones({
  productos,
  cuentas,
  falabella = [],
  onCargarFalabella = () => {},
  onCargar,
  onDuplicar,
}: {
  productos: ProductoHistorial[];
  // Publicaciones de Falabella: van en la misma tabla, mezcladas por fecha.
  falabella?: PublicacionFalabella[];
  onCargarFalabella?: (p: PublicacionFalabella, modo: "reintentar" | "duplicar") => void;
  cuentas: Cuenta[];
  onCargar: (producto: ProductoHistorial) => void;
  onDuplicar: (producto: ProductoHistorial) => void;
}) {
  const [expandidoId, setExpandidoId] = useState<string | null>(null);
  const hf = useHistorialFalabella(falabella);
  const filas = [
    ...productos.map((p) => ({ tipo: "ml" as const, p, ts: p.creadoTs })),
    ...falabella.map((p) => ({ tipo: "fb" as const, p, ts: p.creadoTs })),
  ].sort((a, b) => (a.ts < b.ts ? 1 : a.ts > b.ts ? -1 : 0));

  return (
    <Tarjeta>
      <div id="historial">
        <p className="zx-etiqueta">Historial</p>
        <h2 style={{ fontSize: 18, fontWeight: 700, marginTop: 4 }}>Productos publicados recientemente</h2>
        <BandasPublicando productos={productos} />
        {hf.mensaje && <p style={{ fontSize: 13, color: "var(--kpi-peligro-texto)", marginTop: 8 }}>{hf.mensaje}</p>}
        {filas.length === 0 ? (
          <EstadoVacio>Todavía no se publicó ningún producto.</EstadoVacio>
        ) : (
          <Tabla encabezados={["Título", "Precio", "Estado", "", "Fecha", "Acciones"]}>
            {filas.map((fila) => {
              if (fila.tipo === "fb") {
                return (
                  <FilaFalabella
                    key={`fb-${fila.p.id}`}
                    p={fila.p}
                    h={hf}
                    columnas={CANTIDAD_COLUMNAS}
                    onCargar={(modo) => onCargarFalabella(fila.p, modo)}
                    expandido={expandidoId === `fb-${fila.p.id}`}
                    onToggle={() => setExpandidoId(expandidoId === `fb-${fila.p.id}` ? null : `fb-${fila.p.id}`)}
                  />
                );
              }
              const p = fila.p;
              const enlaces = enlacesPermalink(p.resultado, cuentas);
              const tituloTexto = p.titulo || "(sin título)";
              const expandido = expandidoId === p.id;
              const detalleCuentas = expandido ? detalleCuentasProducto(p.resultado, cuentas) : [];
              const idDetalle = `detalle-publicacion-${p.id}`;
              return (
              <Fragment key={p.id}>
              <FilaTabla>
                <CeldaTabla>
                  {/* Feedback real de Mateo (staging) — el TÍTULO en sí
                  tiene que ser el link clicable a la publicación
                  (target="_blank", rel="noreferrer"). Con una sola
                  cuenta publicada OK, no hay ambigüedad: el título
                  completo abre ESE permalink. Con varias cuentas, el
                  título queda como texto (cuál de los N permalinks
                  abriría si no es un link) y se agrega un link chico
                  por cuenta debajo, con su nickname — mismo criterio
                  que ya pedía el punto B original, "no inventes
                  columna": sigue dentro de la celda de Título. */}
                  {enlaces.length === 1 ? (
                    <a href={enlaces[0].permalink} target="_blank" rel="noreferrer">
                      {tituloTexto}
                    </a>
                  ) : (
                    tituloTexto
                  )}
                  {enlaces.length > 1 && (
                    <div style={{ marginTop: 4, display: "flex", flexDirection: "column", gap: 2 }}>
                      {enlaces.map((e, i) => (
                        <a key={`${e.cuentaMlId}-${i}`} href={e.permalink} target="_blank" rel="noreferrer" style={{ fontSize: 12 }}>
                          {e.etiqueta} ↗
                        </a>
                      ))}
                    </div>
                  )}
                </CeldaTabla>
                <CeldaTabla>{formatearMoneda(Number(p.precio), siteIdDeFila(p.cuentasSeleccionadas, cuentas))}</CeldaTabla>
                <CeldaTabla>
                  <EstadoCelda producto={p} />
                </CeldaTabla>
                <CeldaTabla>
                  {/* Feedback real de Mateo — "ver detalle" NUNCA
                  navega a otra página: despliega la lista por cuenta
                  EN LA MISMA FILA (ver <Fragment> de abajo), con
                  "ocultar" para cerrarla. <button> en vez de <a>/<Link>
                  a propósito — esto no es una navegación real. */}
                  <button
                    type="button"
                    onClick={() => setExpandidoId(expandido ? null : p.id)}
                    aria-expanded={expandido}
                    aria-controls={idDetalle}
                    style={{ background: "none", border: "none", padding: 0, color: "inherit", textDecoration: "underline", cursor: "pointer", font: "inherit" }}
                  >
                    {expandido ? "ocultar" : "ver detalle"}
                  </button>
                </CeldaTabla>
                <CeldaTabla>{formatearFechaBogota(p.creadoTs)}</CeldaTabla>
                <CeldaTabla>
                  <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                    <Boton type="button" variante="primario" onClick={() => onCargar(p)}>
                      Cargar / Reintentar
                    </Boton>
                    <Boton type="button" variante="primario" onClick={() => onDuplicar(p)}>
                      Duplicar
                    </Boton>
                    <form
                      action={borrarProductoAction}
                      onSubmit={(e) => {
                        // Confirmación real (nunca silenciosa) — el
                        // mensaje exacto que pidió Mateo, para que
                        // nadie confunda esto con borrar la
                        // publicación real en Mercado Libre.
                        if (!window.confirm(`¿Borrar "${p.titulo || "(sin título)"}" del historial? No borra nada en Mercado Libre, solo esta fila local.`)) {
                          e.preventDefault();
                        }
                      }}
                    >
                      <input type="hidden" name="id" value={p.id} />
                      <Boton type="submit" variante="fantasma" aria-label="Borrar">
                        🗑
                      </Boton>
                    </form>
                  </div>
                </CeldaTabla>
              </FilaTabla>
              {expandido && (
                <FilaTabla id={idDetalle}>
                  <CeldaTabla colSpan={CANTIDAD_COLUMNAS}>
                    {detalleCuentas.length === 0 ? (
                      <p style={{ fontSize: 13, opacity: 0.7, margin: 0 }}>Publicando en Mercado Libre, un momento…</p>
                    ) : (
                      <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
                        {detalleCuentas.map((fila, i) => (
                          <DetalleCuentaFila key={`${fila.cuentaMlId}-${i}`} fila={fila} />
                        ))}
                      </ul>
                    )}
                  </CeldaTabla>
                </FilaTabla>
              )}
              </Fragment>
              );
            })}
          </Tabla>
        )}
      </div>
    </Tarjeta>
  );
}
