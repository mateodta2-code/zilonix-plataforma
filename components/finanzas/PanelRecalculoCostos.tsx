"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  confirmarRecalculoAction,
  previsualizarRecalculoAction,
  type EstadoConfirmarRecalculo,
  type EstadoVistaRecalculo,
} from "@/app/panel/finanzas/ventas/actions";
import { Boton } from "@/components/marco/Boton";
import { Campo } from "@/components/marco/Campo";
import { CeldaTabla, FilaTabla, Tabla } from "@/components/marco/Tabla";
import { parsearComboSku } from "@/lib/finanzas/combo-sku";
import { mostrarMonto } from "@/lib/finanzas/montos";
import type { CambioCosto, OmitidoRecalculo } from "@/lib/finanzas/recalcular-costos";
import { MENSAJE_FILTRO_VACIO, type EntradaFiltroRecalculo } from "@/lib/finanzas/recalculo-pantalla";
import estilos from "./ventasUtilidad.module.css";

// Issue #131 (Parte C) — recalcular el costo congelado de ventas ya
// guardadas con el costo actual de la tabla maestra. Primero «Ver
// cambios» (no escribe nada); solo «Confirmar recálculo» escribe, y
// manda exactamente los cambios que la persona vio con el MISMO filtro
// de esa vista (no lo que haya en el formulario después). La page solo
// lo pinta con finanzas.modificar; las actions lo vuelven a pedir.

type Vista = { cambios: CambioCosto[]; omitidos: OmitidoRecalculo[] };
type Aviso = { tipo: "exito" | "error"; lineas: string[] };

const ETIQUETA_OMITIDO: Record<OmitidoRecalculo["motivo"], string> = {
  correccion_manual: "Corrección a mano",
  sin_costo_en_maestra: "Sin costo en la maestra",
};

function textoOrigen(cambio: CambioCosto): string {
  if (cambio.origen === "exacto") return "fila de la maestra";
  const combo = parsearComboSku(cambio.skuCodigo);
  return combo ? `${combo.base} × ${combo.multiplicador}` : "base × N";
}

function plural(n: number, uno: string, varios: string): string {
  return `${n} ${n === 1 ? uno : varios}`;
}

export function PanelRecalculoCostos() {
  const router = useRouter();
  const [pendiente, iniciar] = useTransition();
  const [accion, setAccion] = useState<"ver" | "confirmar" | null>(null);
  const [sku, setSku] = useState("");
  const [desde, setDesde] = useState("");
  const [hasta, setHasta] = useState("");
  // El filtro con el que se armó la vista: es el que se confirma.
  const [consultado, setConsultado] = useState<EntradaFiltroRecalculo | null>(null);
  const [vista, setVista] = useState<Vista | null>(null);
  const [aviso, setAviso] = useState<Aviso | null>(null);

  function verCambios(evento: React.FormEvent) {
    evento.preventDefault();
    const filtro: EntradaFiltroRecalculo = { skuCodigo: sku.trim(), desde, hasta };
    if (!filtro.skuCodigo && !desde && !hasta) {
      setAviso({ tipo: "error", lineas: [MENSAJE_FILTRO_VACIO] });
      return;
    }
    setAviso(null);
    setVista(null);
    setAccion("ver");
    iniciar(async () => {
      let estado: EstadoVistaRecalculo;
      try {
        estado = await previsualizarRecalculoAction(filtro);
      } catch {
        estado = { ok: false, lineas: ["No se pudo armar la vista previa. Inténtalo de nuevo."] };
      }
      if (estado.ok) {
        setConsultado(filtro);
        setVista({ cambios: estado.cambios, omitidos: estado.omitidos });
      } else {
        setAviso({ tipo: "error", lineas: estado.lineas });
      }
    });
  }

  function confirmar() {
    if (!consultado || !vista || vista.cambios.length === 0) return;
    const vistos = vista.cambios.map(({ pedidoId, linea, antes, despues }) => ({ pedidoId, linea, antes, despues }));
    setAviso(null);
    setAccion("confirmar");
    iniciar(async () => {
      let estado: EstadoConfirmarRecalculo;
      try {
        estado = await confirmarRecalculoAction({ ...consultado, vistos });
      } catch {
        estado = { ok: false, lineas: ["No se pudo aplicar el recálculo. No se cambió nada; inténtalo de nuevo."] };
      }
      if (estado.ok) {
        setVista(null);
        setConsultado(null);
        setAviso({
          tipo: "exito",
          lineas: [`Listo: ${plural(estado.ventas, "venta", "ventas")} · ${plural(estado.lineas, "línea actualizada", "líneas actualizadas")}.`],
        });
        router.refresh();
        return;
      }
      setAviso({ tipo: "error", lineas: estado.lineas });
      // Desactualizada: la vista nueva reemplaza a la vieja y hay que
      // confirmar otra vez.
      if (estado.vista) setVista(estado.vista);
    });
  }

  const hayCambios = (vista?.cambios.length ?? 0) > 0;

  return (
    <section className={estilos.recalculo} aria-labelledby="titulo-recalculo">
      <h2 id="titulo-recalculo" className={estilos.tituloSeccion}>
        Recalcular costo con la tabla maestra
      </h2>
      <p className={estilos.suave}>
        Las ventas ya guardadas no cambian solas cuando actualizas un costo. Aquí ves qué pasaría (antes → después) y solo se aplica si
        confirmas. Solo cambia el costo del producto; packing, envío y comisión no se tocan. Las correcciones a mano no se pisan.
      </p>
      <p className={estilos.suave}>Si pones el SKU base (ej. BASE), también entran sus combos BASEX2 y BASEX3.</p>

      <form onSubmit={verCambios} className={estilos.formRecalculo}>
        <Campo etiqueta="SKU">
          <input type="text" value={sku} onChange={(e) => setSku(e.target.value)} placeholder="BASE o BASEX2" className="zx-control" />
        </Campo>
        <Campo etiqueta="Desde">
          <input type="date" value={desde} onChange={(e) => setDesde(e.target.value)} className="zx-control" />
        </Campo>
        <Campo etiqueta="Hasta (incluido)">
          <input type="date" value={hasta} onChange={(e) => setHasta(e.target.value)} className="zx-control" />
        </Campo>
        <div className={estilos.accionesFiltro}>
          <Boton type="submit" chico disabled={pendiente}>
            {pendiente && accion === "ver" ? "Buscando…" : "Ver cambios"}
          </Boton>
        </div>
      </form>

      {aviso && (
        <div className={aviso.tipo === "exito" ? estilos.avisoExito : estilos.avisoError} role="status">
          <ul className={estilos.listaSimple}>
            {aviso.lineas.map((linea) => (
              <li key={linea}>{linea}</li>
            ))}
          </ul>
        </div>
      )}

      {vista && (
        <div className={estilos.vistaRecalculo}>
          <p className={estilos.resumenRecalculo}>
            {plural(vista.cambios.length, "línea cambiaría", "líneas cambiarían")} · {plural(vista.omitidos.length, "omitida", "omitidas")}
          </p>

          {hayCambios ? (
            <div className={estilos.tablaRecalculo}>
              <Tabla encabezados={["Pedido ML", "Línea", "SKU", "Costo actual", "Costo nuevo", "Origen"]}>
                {vista.cambios.map((c) => (
                  <FilaTabla key={`${c.pedidoId}-${c.linea}`}>
                    <CeldaTabla>
                      <Link href={`/panel/finanzas/ventas/${c.pedidoId}`} className={estilos.enlace}>
                        {c.pedidoIdExterno}
                      </Link>
                    </CeldaTabla>
                    <CeldaTabla className={estilos.numero}>{c.linea}</CeldaTabla>
                    <CeldaTabla>{c.skuCodigo}</CeldaTabla>
                    <CeldaTabla className={estilos.numero}>{c.antes === null ? "Sin costo" : mostrarMonto(c.antes)}</CeldaTabla>
                    <CeldaTabla className={estilos.numero}>{mostrarMonto(c.despues)}</CeldaTabla>
                    <CeldaTabla>{textoOrigen(c)}</CeldaTabla>
                  </FilaTabla>
                ))}
              </Tabla>
            </div>
          ) : (
            <p className={estilos.suave}>No hay nada que cambiar con ese filtro.</p>
          )}

          {vista.omitidos.length > 0 && (
            <details className={estilos.omitidos}>
              <summary>{plural(vista.omitidos.length, "línea omitida", "líneas omitidas")} (no se tocan)</summary>
              <ul className={estilos.listaSimple}>
                {vista.omitidos.map((o) => (
                  <li key={`${o.pedidoId}-${o.linea}`}>
                    {ETIQUETA_OMITIDO[o.motivo]} · {o.skuCodigo ?? "sin SKU"} · línea {o.linea} ·{" "}
                    <Link href={`/panel/finanzas/ventas/${o.pedidoId}`} className={estilos.enlace}>
                      ver venta
                    </Link>
                  </li>
                ))}
              </ul>
            </details>
          )}

          {hayCambios && (
            <div className={estilos.accionesFiltro}>
              <Boton type="button" onClick={confirmar} disabled={pendiente}>
                {pendiente && accion === "confirmar" ? "Aplicando…" : `Confirmar recálculo (${plural(vista.cambios.length, "línea", "líneas")})`}
              </Boton>
              <span className={estilos.suave}>Se aplica a lo que ves arriba. Si algo cambió mientras tanto, no se escribe nada.</span>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
