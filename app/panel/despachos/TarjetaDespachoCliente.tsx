"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Tarjeta } from "@/components/marco/Tarjeta";
import { Boton } from "@/components/marco/Boton";
import { Chip, type EstadoChip } from "@/components/marco/Chip";
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
  puedeModificar: boolean;
  ventanaDeshacerMs: number;
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

  function abrirGuia(formato: "normal" | "sticker") {
    window.open(`/api/ml/despachos/etiqueta?despachoId=${props.id}&formato=${formato}`, "_blank");
    setGuiaVista(true);
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
                  <div className={styles.contenedorImagen}>
                    {item.imagenUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element -- miniatura externa de Mercado Libre, no un asset propio del proyecto.
                      <img src={item.imagenUrl} alt={item.titulo} className={styles.imagenItem} tabIndex={0} />
                    ) : (
                      <div className={styles.imagenItemVacia} aria-hidden="true" />
                    )}
                    {item.imagenUrl && (
                      <div className={styles.lupa} aria-hidden="true">
                        {/* eslint-disable-next-line @next/next/no-img-element -- mismo archivo, solo a escala para el zoom */}
                        <img src={item.imagenUrl} alt="" />
                      </div>
                    )}
                  </div>
                  <div className={styles.datosItem}>
                    {href ? (
                      <a href={href} target="_blank" rel="noopener noreferrer" className={styles.tituloItem}>
                        {item.titulo}
                      </a>
                    ) : (
                      <p className={styles.tituloItem}>{item.titulo}</p>
                    )}
                    <p className={styles.lineaDatos}>
                      Cantidad: {item.cantidad} · SKU: {item.skuCodigo ?? "—"} · Vendido a: {formatoPrecio(item.precioUnitario)} ·{" "}
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
          ) : (
            <>
              <Boton variante="secundario" chico type="button" onClick={() => abrirGuia("normal")}>
                Ver guía (PDF)
              </Boton>
              <Boton variante="secundario" chico type="button" onClick={() => abrirGuia("sticker")}>
                Ver guía (sticker)
              </Boton>
              {props.puedeModificar && (
                <Boton chico type="button" onClick={marcar} disabled={!guiaVista || enCurso} title={guiaVista ? undefined : "Abre la guía arriba primero"}>
                  Marcar despachado
                </Boton>
              )}
            </>
          )}
          {error && <p className={styles.errorTarjeta}>{error}</p>}
        </div>
      </div>
    </Tarjeta>
  );
}
