"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Tarjeta } from "@/components/marco/Tarjeta";
import { Boton } from "@/components/marco/Boton";
import { Chip, type EstadoChip } from "@/components/marco/Chip";
import { deshacerDespachadoAction, marcarDespachadoAction } from "./actions";
import styles from "./page.module.css";

export type ItemTarjetaDespachoProps = { itemIdExterno: string; titulo: string; cantidad: number; skuCodigo: string | null; imagenUrl: string | null };

export type TarjetaDespachoProps = {
  id: string;
  shipmentIdExterno: string;
  logisticType: string | null;
  status: string | null;
  slaExpectedDate: Date | null;
  guiaVistaTs: Date | null;
  despachadoTs: Date | null;
  imprimible: boolean;
  etiquetaImpresaTs: Date | null;
  cuentaNickname: string;
  pedidoIdExterno: string;
  fechaPedido: Date;
  comprador: string | null;
  items: ItemTarjetaDespachoProps[];
  etiquetaTipo: string;
  esFlex: boolean;
  chipPlazo: string | null;
  plazoVencido: boolean;
  colorEstado: EstadoChip;
  puedeModificar: boolean;
  ventanaDeshacerMs: number;
};

function formatoFechaColombia(fecha: Date): string {
  return fecha.toLocaleString("es-CO", { timeZone: "America/Bogota" });
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

  return (
    <Tarjeta>
      <div className={styles.encabezadoTarjeta} data-flex={props.esFlex ? "true" : "false"}>
        <Chip estado={props.esFlex ? "aviso" : "neutro"}>{props.etiquetaTipo}</Chip>
        <Chip estado={props.colorEstado}>{props.status ?? "—"}</Chip>
        {props.chipPlazo && <Chip estado={props.plazoVencido ? "peligro" : "neutro"}>{props.chipPlazo}</Chip>}
      </div>

      {props.esFlex && <p className={styles.avisoFlex}>Entregar a domiciliario.</p>}

      <div className={styles.filaItems}>
        {props.items.map((item) => (
          <div key={item.itemIdExterno} className={styles.filaItem}>
            {item.imagenUrl ? (
              // eslint-disable-next-line @next/next/no-img-element -- miniatura externa de Mercado Libre, no un asset propio del proyecto.
              <img src={item.imagenUrl} alt={item.titulo} className={styles.imagenItem} />
            ) : (
              <div className={styles.imagenItemVacia} aria-hidden="true" />
            )}
            <div>
              <p className={styles.tituloItem}>{item.titulo}</p>
              <p className={styles.detalleItem}>
                Cantidad: {item.cantidad} · SKU: {item.skuCodigo ?? "—"}
              </p>
            </div>
          </div>
        ))}
      </div>

      <dl className={styles.datosTarjeta}>
        <div>
          <dt>Vendido a</dt>
          <dd>{props.comprador ?? "No disponible"}</dd>
        </div>
        <div>
          <dt>Cuenta</dt>
          <dd>{props.cuentaNickname}</dd>
        </div>
        <div>
          <dt>Orden</dt>
          <dd>#{props.pedidoIdExterno}</dd>
        </div>
        <div>
          <dt>Fecha</dt>
          <dd>{formatoFechaColombia(props.fechaPedido)}</dd>
        </div>
      </dl>

      {props.despachadoTs ? (
        dentroDeVentana ? (
          <Boton variante="secundario" chico onClick={deshacer} disabled={enCurso}>
            Deshacer
          </Boton>
        ) : (
          <p className={styles.notaDespachado}>Despachado — ya no se puede deshacer.</p>
        )
      ) : (
        <div className={styles.acciones}>
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
        </div>
      )}
      {error && <p className={styles.errorTarjeta}>{error}</p>}
    </Tarjeta>
  );
}
