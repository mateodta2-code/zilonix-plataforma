"use client";

import { Fragment, useState } from "react";
import Link from "next/link";
import type { DiaDetalle } from "@/lib/finanzas/detalle-ventas";
import { Chip } from "@/components/marco/Chip";
import { IconoChevron } from "@/components/marco/iconos";
import { CeldaTabla, Tabla } from "@/components/marco/Tabla";
import { CeldasMontos } from "./CeldasMontos";
import { ETIQUETA_FORMA } from "./formato";
import estilos from "./ventasUtilidad.module.css";

// Issue #131 — «Detalle día a día · cuenta · producto» como acordeón,
// igual que Zilonix OS: el día pliega sus cuentas y productos, la
// cuenta pliega sus productos. Arranca con el día más nuevo de la página
// abierto (con todas sus cuentas abiertas) y los demás cerrados. El
// server (DetalleDiaCuentaProducto) calcula todo y pasa datos
// serializables; acá solo vive qué está abierto. Al cambiar de página o
// de filtro el server cambia la `key` y el estado vuelve a empezar.

type Props = {
  encabezados: string[];
  dias: DiaDetalle[];
  // pedido_id → número de orden de ML, solo de los pedidos de la página.
  pedidoIdExterno: Record<string, string>;
  // Pedidos con reembolsos > 0.
  conDevolucion: string[];
};

function diaMasNuevo(dias: DiaDetalle[]): string | null {
  return dias.reduce<string | null>((nuevo, d) => (nuevo === null || d.dia > nuevo ? d.dia : nuevo), null);
}

function plural(n: number, uno: string, varios: string): string {
  return n === 1 ? uno : varios;
}

export function TablaDetalleAcordeon({ encabezados, dias, pedidoIdExterno, conDevolucion }: Props) {
  const [diasAbiertos, setDiasAbiertos] = useState<Set<string>>(() => {
    const nuevo = diaMasNuevo(dias);
    return new Set(nuevo === null ? [] : [nuevo]);
  });
  // Las cuentas arrancan abiertas: se guardan las cerradas («día|cuenta»).
  const [cuentasCerradas, setCuentasCerradas] = useState<Set<string>>(() => new Set());
  const devoluciones = new Set(conDevolucion);

  function alternar(conjunto: Set<string>, clave: string): Set<string> {
    const siguiente = new Set(conjunto);
    if (siguiente.has(clave)) siguiente.delete(clave);
    else siguiente.add(clave);
    return siguiente;
  }

  return (
    <Tabla encabezados={encabezados}>
      {dias.map((dia) => {
        const diaAbierto = diasAbiertos.has(dia.dia);
        const textoDia = `${dia.dia} · ${dia.numero_cuentas} ${plural(dia.numero_cuentas, "cuenta", "cuentas")} · ${dia.numero_ventas} ${plural(dia.numero_ventas, "venta", "ventas")}`;
        return (
          <Fragment key={dia.dia}>
            <tr className={estilos.filaDia}>
              <CeldaTabla>
                <button
                  type="button"
                  className={estilos.controlNivel}
                  aria-expanded={diaAbierto}
                  onClick={() => setDiasAbiertos((actual) => alternar(actual, dia.dia))}
                  title={textoDia}
                >
                  <IconoChevron size={12} className={estilos.chevron} />
                  {/* Corto, para que la 1ª columna no estire la tabla: «2 cta · 12 vtas». */}
                  <span className={estilos.textoNivel}>
                    {dia.dia} · {dia.numero_cuentas} cta · {dia.numero_ventas} {plural(dia.numero_ventas, "vta", "vtas")}
                  </span>
                </button>
              </CeldaTabla>
              <CeldasMontos t={dia.totales} costo={dia.totales.costo_producto} utilidad={dia.totales.utilidad} />
            </tr>
            {diaAbierto &&
              dia.cuentas.map((cuenta) => {
                const clave = `${dia.dia}|${cuenta.cuenta_ml_id}`;
                const cuentaAbierta = !cuentasCerradas.has(clave);
                return (
                  <Fragment key={cuenta.cuenta_ml_id}>
                    <tr className={estilos.filaCuenta}>
                      <CeldaTabla className={estilos.sangriaCuenta}>
                        <button
                          type="button"
                          className={estilos.controlNivel}
                          aria-expanded={cuentaAbierta}
                          onClick={() => setCuentasCerradas((actual) => alternar(actual, clave))}
                          title={`${cuenta.nickname} · ${cuenta.numero_ventas} ${plural(cuenta.numero_ventas, "venta", "ventas")}`}
                        >
                          <IconoChevron size={12} className={estilos.chevron} />
                          <span className={estilos.textoNivel}>
                            {cuenta.nickname} · {cuenta.numero_ventas} Vta
                          </span>
                        </button>
                      </CeldaTabla>
                      <CeldasMontos t={cuenta.totales} costo={cuenta.totales.costo_producto} utilidad={cuenta.totales.utilidad} />
                    </tr>
                    {cuentaAbierta &&
                      cuenta.productos.map((p) => (
                        <tr key={`${p.pedido_id}-${p.linea}`} className={estilos.filaProducto}>
                          <CeldaTabla className={estilos.sangriaProducto}>
                            {/* Bloque de ancho fijo en dos líneas, como Zilonix OS: el
                                título usa el ancho de la columna (si aún no cabe, «…»)
                                y SKU y número de pedido van debajo. Todo se lee entero
                                al pasar el mouse. */}
                            <div
                              className={estilos.lineaProducto}
                              title={`${p.titulo} · ${p.sku_codigo ?? "sin SKU"} · ${ETIQUETA_FORMA[p.forma_entrega]} · #${pedidoIdExterno[p.pedido_id]}`}
                            >
                              {/* Línea 1: título y chips; línea 2: SKU y número de pedido. */}
                              <div className={estilos.filaTituloProducto}>
                                <Link href={`/panel/finanzas/ventas/${p.pedido_id}`} className={`${estilos.enlace} ${estilos.tituloProducto}`}>
                                  {p.titulo}
                                </Link>
                                <Chip>{ETIQUETA_FORMA[p.forma_entrega]}</Chip>
                                {devoluciones.has(p.pedido_id) && (
                                  <Chip estado="peligro" title="Con devolución: revisar">
                                    devolución
                                  </Chip>
                                )}
                              </div>
                              <div className={estilos.filaDatosProducto}>
                                <span className={estilos.datoProducto}>[{p.sku_codigo ?? "sin SKU"}]</span>
                                <span className={estilos.datoProducto}>#{pedidoIdExterno[p.pedido_id]}</span>
                              </div>
                            </div>
                          </CeldaTabla>
                          <CeldasMontos t={p} costo={p.costo_producto} utilidad={p.utilidad} />
                        </tr>
                      ))}
                  </Fragment>
                );
              })}
          </Fragment>
        );
      })}
    </Tabla>
  );
}
