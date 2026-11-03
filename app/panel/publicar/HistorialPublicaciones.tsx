"use client";

import { Fragment, useState } from "react";
import { Boton } from "@/components/marco/Boton";
import { CeldaTabla, FilaTabla, Tabla } from "@/components/marco/Tabla";
import { Tarjeta } from "@/components/marco/Tarjeta";
import { Chip } from "@/components/marco/Chip";
import { EstadoVacio } from "@/components/marco/EstadoVacio";
import type { Cuenta } from "./CuentasDestino";
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
import { etiquetaPublicacionCuenta } from "@/lib/ml/estado-publicacion";

const CANTIDAD_COLUMNAS = 6; // Título, Precio, Estado, "", Fecha, Acciones — ancho del <td colSpan> del detalle desplegado.

export type ProductoHistorial = FilaProductoParaCargar & {
  id: string;
  titulo: string | null;
  estado: string;
  creadoTs: string;
};

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
  const resumen = resumenEstadoProducto(producto.resultado);
  if (!resumen) return <Chip>{ETIQUETA_ESTADO[producto.estado] ?? producto.estado}</Chip>;
  const estadoChip = resumen.icono === "✅" ? "exito" : resumen.icono === "❌" ? "peligro" : "aviso";
  return (
    <Chip estado={estadoChip}>
      {resumen.icono} {resumen.ok}/{resumen.total}
    </Chip>
  );
}

type EstadoRealCuenta = { cargando: boolean; status: string | null; error: string | null };

// Issue "historial de Publicar — detalle en español, in-place" — una
// cuenta por línea, dentro del <td colSpan> desplegado. `etiquetaPublicacionCuenta`
// distingue "Publicado (sin verificar)" (status guardado al publicar,
// nunca confirmado de nuevo) de "Publicado y activo" (después de
// apretar "Ver estado real") — mismo criterio que zilonix-os-web.
function DetalleCuentaFila({ fila }: { fila: FilaDetalleCuenta }) {
  const [estadoReal, setEstadoReal] = useState<EstadoRealCuenta>({ cargando: false, status: null, error: null });

  async function verEstadoReal() {
    if (!fila.itemId) return;
    setEstadoReal({ cargando: true, status: null, error: null });
    try {
      const params = new URLSearchParams({ cuentaId: fila.cuentaMlId, itemId: fila.itemId });
      const resp = await fetch(`/api/ml/publicar/estado-item?${params.toString()}`);
      const datos = (await resp.json().catch(() => null)) as { status?: unknown; error?: unknown } | null;
      if (!resp.ok || !datos) {
        setEstadoReal({ cargando: false, status: null, error: typeof datos?.error === "string" ? datos.error : "No se pudo consultar el estado real." });
        return;
      }
      setEstadoReal({ cargando: false, status: typeof datos.status === "string" ? datos.status : null, error: null });
    } catch {
      setEstadoReal({ cargando: false, status: null, error: "No se pudo consultar el estado real — revisá tu conexión." });
    }
  }

  return (
    <li style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 8, padding: "6px 0", borderBottom: "1px solid var(--borde)", fontSize: 13 }}>
      <strong>{fila.nickname}</strong>
      {fila.subEtiqueta && <span style={{ opacity: 0.7 }}>({fila.subEtiqueta})</span>}
      {fila.error ? (
        <span style={{ color: "var(--peligro-texto)" }}>{fila.error}</span>
      ) : (
        <>
          <span>{etiquetaPublicacionCuenta(estadoReal.status)}</span>
          {fila.permalink && (
            <a href={fila.permalink} target="_blank" rel="noreferrer">
              Ver publicación ↗
            </a>
          )}
          {fila.itemId && (
            <Boton type="button" variante="fantasma" chico onClick={verEstadoReal} disabled={estadoReal.cargando}>
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
  onCargar,
  onDuplicar,
}: {
  productos: ProductoHistorial[];
  cuentas: Cuenta[];
  onCargar: (producto: ProductoHistorial) => void;
  onDuplicar: (producto: ProductoHistorial) => void;
}) {
  const [expandidoId, setExpandidoId] = useState<string | null>(null);

  return (
    <Tarjeta>
      <div id="historial">
        <p className="zx-etiqueta">Historial</p>
        <h2 style={{ fontSize: 18, fontWeight: 700, marginTop: 4 }}>Productos publicados recientemente</h2>
        {productos.length === 0 ? (
          <EstadoVacio>Todavía no se publicó ningún producto.</EstadoVacio>
        ) : (
          <Tabla encabezados={["Título", "Precio", "Estado", "", "Fecha", "Acciones"]}>
            {productos.map((p) => {
              const enlaces = enlacesPermalink(p.resultado, cuentas);
              const tituloTexto = p.titulo || "(sin título)";
              const expandido = expandidoId === p.id;
              const detalleCuentas = expandido ? detalleCuentasProducto(p.resultado, cuentas) : [];
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
                    style={{ background: "none", border: "none", padding: 0, color: "inherit", textDecoration: "underline", cursor: "pointer", font: "inherit" }}
                  >
                    {expandido ? "ocultar" : "ver detalle"}
                  </button>
                </CeldaTabla>
                <CeldaTabla>{formatearFechaBogota(p.creadoTs)}</CeldaTabla>
                <CeldaTabla>
                  <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                    <Boton type="button" variante="secundario" chico onClick={() => onCargar(p)}>
                      Cargar / Reintentar
                    </Boton>
                    <Boton type="button" variante="secundario" chico onClick={() => onDuplicar(p)}>
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
                      <Boton type="submit" variante="fantasma" chico aria-label="Borrar">
                        🗑
                      </Boton>
                    </form>
                  </div>
                </CeldaTabla>
              </FilaTabla>
              {expandido && (
                <FilaTabla>
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
