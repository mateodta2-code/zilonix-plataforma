"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Tarjeta } from "@/components/marco/Tarjeta";
import { Boton } from "@/components/marco/Boton";
import { Chip, type EstadoChip } from "@/components/marco/Chip";
import { CopiarTexto } from "@/components/marco/CopiarTexto";
import { FotoConZoom } from "@/components/marco/FotoConZoom";
import { urlFotoGrandeMl } from "@/lib/ml/imagen-ml";
import { linkPublicacion } from "@/lib/ml/permalink";
import type { EstadoPlazo } from "@/lib/ml/despachos";
import { deshacerDespachadoAction, marcarDespachadoAction } from "./actions";
import styles from "./page.module.css";

export type ItemTarjetaDespachoProps = {
  itemIdExterno: string;
  titulo: string;
  cantidad: number;
  skuCodigo: string | null;
  imagenUrl: string | null;
  precioUnitario: string;
  stockDisponible: number | null;
};

export type TarjetaDespachoProps = {
  id: string;
  logisticType: string | null;
  status: string | null;
  // Chip del encabezado — revisión de Pablo (PR #310): el status real
  // de Mercado Libre va traducido (etiquetaEstadoEnvio(status, null),
  // lib/ml/despachos.ts), nunca el inglés crudo que manda la API.
  estadoTraducido: string | null;
  despachadoTs: Date | null;
  guiaVistaTs: Date | null;
  cuentaNickname: string;
  pedidoIdExterno: string;
  fechaPedido: Date;
  comprador: string | null;
  bodegaAsignada: string | null;
  items: ItemTarjetaDespachoProps[];
  etiquetaTipo: string;
  esFlex: boolean;
  chipPlazo: string | null;
  estadoPlazo: EstadoPlazo | null;
  estadoEnvioTexto: string | null;
  // Issue "Despachados (15 días)" — solo en la pestaña Despachados:
  // cuál de las dos cosas puso a este despacho ahí. null en
  // Pendientes (no aplica).
  origenDespacho: "marcado_en_seller" | "recogido_transportadora" | null;
  // Issue "ocultar imprimir en recogidas" — bug real reportado por
  // Mateo en staging: pedir la guía de un envío que la transportadora
  // YA recogió (substatus en SUBESTADOS_YA_SALIO o status shipped/
  // delivered) hace que Mercado Libre la rechace (NOT_PRINTABLE_STATUS)
  // — ya calculado server-side (calcularImprimible, lib/ml/despachos.ts,
  // la MISMA regla que decide si el despacho sigue en "pendientes de
  // imprimir"), nunca recalculado acá. false ⟺ origenDespacho ===
  // "recogido_transportadora" (misma fila, mismo UPDATE) — se usa esto,
  // no ese campo, porque también cubre Pendientes si quedó una fila
  // vieja sin refrescar todavía.
  imprimible: boolean;
  puedeModificar: boolean;
  ventanaDeshacerMs: number;
};

const ETIQUETA_ORIGEN_DESPACHO: Record<"marcado_en_seller" | "recogido_transportadora", string> = {
  marcado_en_seller: "Marcado en Seller",
  recogido_transportadora: "Recogido por la transportadora",
};

function formatoFechaColombia(fecha: Date): string {
  return fecha.toLocaleString("es-CO", { timeZone: "America/Bogota" });
}

function formatoPrecio(precio: string): string {
  const numero = Number(precio);
  if (!Number.isFinite(numero)) return precio;
  return numero.toLocaleString("es-CO", { style: "currency", currency: "COP", maximumFractionDigits: 0 });
}

export function TarjetaDespachoCliente(props: TarjetaDespachoProps) {
  const router = useRouter();
  const [guiaVista, setGuiaVista] = useState(props.guiaVistaTs != null);
  const [enCurso, setEnCurso] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dentroDeVentana, setDentroDeVentana] = useState(
    props.despachadoTs != null && Date.now() - props.despachadoTs.getTime() < props.ventanaDeshacerMs
  );

  useEffect(() => {
    if (!props.despachadoTs) return;
    const venceEn = props.despachadoTs.getTime() + props.ventanaDeshacerMs;
    const intervalo = setInterval(() => setDentroDeVentana(Date.now() < venceEn), 1_000);
    return () => clearInterval(intervalo);
  }, [props.despachadoTs, props.ventanaDeshacerMs]);

  // Bug real reportado por Mateo en staging: abrirGuia hacía
  // window.open(url) directo sobre el Route Handler — cuando Mercado
  // Libre rechaza la guía (ej. ya recogida), el Route Handler responde
  // JSON (nunca un PDF), y esa pestaña nueva mostraba el JSON crudo.
  // Ahora se pide primero con fetch: si falla, el error se muestra
  // ACÁ (mismo párrafo de styles.errorTarjeta que ya usan marcar/
  // deshacer), nunca una pestaña con el error. Solo si de verdad
  // vino un PDF se abre la pestaña (con un blob: URL propio, nunca
  // la URL del Route Handler — así esa pestaña nunca puede terminar
  // mostrando un JSON aunque algo cambie del otro lado).
  async function abrirGuia(formato: "normal" | "sticker") {
    setEnCurso(true);
    setError(null);
    try {
      const resp = await fetch(`/api/ml/despachos/etiqueta?despachoId=${props.id}&formato=${formato}`);
      if (!resp.ok) {
        const datos: unknown = await resp.json().catch(() => null);
        const mensaje = datos && typeof datos === "object" && "error" in datos && typeof datos.error === "string" ? datos.error : "No se pudo obtener la guía de Mercado Libre.";
        setError(mensaje);
        return;
      }
      const pdf = await resp.blob();
      window.open(URL.createObjectURL(pdf), "_blank");
      setGuiaVista(true);
    } catch {
      setError("No se pudo obtener la guía de Mercado Libre.");
    } finally {
      setEnCurso(false);
    }
  }

  async function marcar() {
    setEnCurso(true);
    setError(null);
    const resultado = await marcarDespachadoAction(props.id);
    setEnCurso(false);
    if (!resultado.ok) {
      setError(resultado.error);
      return;
    }
    router.refresh();
  }

  async function deshacer() {
    setEnCurso(true);
    setError(null);
    const resultado = await deshacerDespachadoAction(props.id);
    setEnCurso(false);
    if (!resultado.ok) {
      setError(resultado.error);
      return;
    }
    router.refresh();
  }

  const colorEstado: EstadoChip = props.status === "ready_to_ship" ? "exito" : props.status === "handling" || props.status === "pending" ? "aviso" : "neutro";

  return (
    <Tarjeta>
      {props.esFlex && <div className={styles.fondoFlex} aria-hidden="true" />}
      <div className={styles.tarjetaAncha}>
        <div className={styles.columnaInfo}>
          {props.esFlex && <p className={styles.etiquetaFlex}>⚡ FLEX — entregar a domiciliario</p>}

          <div className={styles.encabezadoTarjeta}>
            <Chip estado="neutro">{props.etiquetaTipo}</Chip>
            <Chip estado={colorEstado}>{props.estadoTraducido ?? "—"}</Chip>
            {props.origenDespacho && <Chip estado={props.origenDespacho === "marcado_en_seller" ? "exito" : "aviso"}>{ETIQUETA_ORIGEN_DESPACHO[props.origenDespacho]}</Chip>}
            {props.chipPlazo && (
              <span className={styles.chipPlazo} data-estado={props.estadoPlazo ?? "normal"}>
                {props.chipPlazo}
              </span>
            )}
          </div>

          <div className={styles.filaItems}>
            {props.items.map((item) => {
              const href = linkPublicacion(item.itemIdExterno);
              const stockAgotado = item.stockDisponible != null && item.stockDisponible <= 0;
              return (
                <div key={item.itemIdExterno} className={styles.filaItem}>
                  {item.imagenUrl ? (
                    <FotoConZoom src={item.imagenUrl} srcAmpliada={urlFotoGrandeMl(item.imagenUrl)} alt={item.titulo} claseMiniatura={styles.imagenItem} />
                  ) : (
                    <div className={styles.imagenItemVacia} aria-hidden="true" />
                  )}
                  <div className={styles.datosItem}>
                    {href ? (
                      <a href={href} target="_blank" rel="noopener noreferrer" className={styles.tituloItem}>
                        {item.titulo}
                      </a>
                    ) : (
                      <p className={styles.tituloItem}>{item.titulo}</p>
                    )}
                    <p className={styles.lineaDatos}>
                      Cantidad: {item.cantidad} · SKU:{" "}
                      {item.skuCodigo ? (
                        <CopiarTexto valor={item.skuCodigo} etiquetaAria={`Copiar SKU ${item.skuCodigo}`} mensajeCopiado="SKU copiado" />
                      ) : (
                        "—"
                      )}{" "}
                      · Vendido a: {formatoPrecio(item.precioUnitario)} ·{" "}
                      <span className={stockAgotado ? styles.stockAgotado : undefined}>Stock: {item.stockDisponible ?? "—"}</span>
                    </p>
                  </div>
                </div>
              );
            })}
          </div>

          <p className={styles.lineaDatos}>
            Cuenta {props.cuentaNickname} · Orden #{props.pedidoIdExterno} · Comprador: {props.comprador ?? "—"} · {formatoFechaColombia(props.fechaPedido)} ·
            Bodega: {props.bodegaAsignada ?? "—"}
            <select className={`zx-control ${styles.selectBodega}`} disabled title="Próximamente" aria-label="Cambiar bodega a mano (próximamente)">
              <option>Cambiar a mano…</option>
            </select>
          </p>

          {props.estadoEnvioTexto && <p className={styles.lineaDatos}>🚚 Estado del envío: {props.estadoEnvioTexto}</p>}
        </div>

        <div className={styles.columnaAcciones}>
          {props.despachadoTs ? (
            dentroDeVentana ? (
              <Boton variante="secundario" chico onClick={deshacer} disabled={enCurso}>
                Deshacer
              </Boton>
            ) : (
              <p className={styles.notaDespachado}>Despachado — ya no se puede deshacer.</p>
            )
          ) : props.imprimible ? (
            <>
              <Boton variante="secundario" chico type="button" onClick={() => abrirGuia("normal")} disabled={enCurso}>
                Ver guía (PDF)
              </Boton>
              <Boton variante="secundario" chico type="button" onClick={() => abrirGuia("sticker")} disabled={enCurso}>
                Ver guía (sticker)
              </Boton>
              {props.puedeModificar && (
                <Boton chico type="button" onClick={marcar} disabled={!guiaVista || enCurso} title={guiaVista ? undefined : "Abre la guía arriba primero"}>
                  Marcar despachado
                </Boton>
              )}
            </>
          ) : (
            // Issue "ocultar imprimir en recogidas": sin imprimible,
            // Mercado Libre ya no deja pedir la guía (ni "Ver guía" ni
            // "Marcar despachado" tienen sentido — nunca se llega a
            // marcar algo que la transportadora ya recogió sola).
            <p className={styles.notaDespachado}>Guía ya no disponible: la transportadora ya la recogió.</p>
          )}
          {error && <p className={styles.errorTarjeta}>{error}</p>}
        </div>
      </div>
    </Tarjeta>
  );
}
