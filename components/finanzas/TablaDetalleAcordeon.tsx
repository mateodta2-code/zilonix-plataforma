"use client";

import { Fragment, useState } from "react";
import Link from "next/link";
import type { DiaDetalle } from "@/lib/finanzas/detalle-ventas";
import { Chip } from "@/components/marco/Chip";
import { IconoChevron } from "@/components/marco/iconos";
import { CeldaTabla, Tabla, type EncabezadoTabla, type GrupoEncabezado } from "@/components/marco/Tabla";
import { CeldasMontos } from "./CeldasMontos";
import { ETIQUETA_FORMA, fechaDiaLegible } from "./formato";
import estilos from "./ventasUtilidad.module.css";
import { SkuCopiable } from "@/components/marco/SkuCopiable";

// Issue #131 — «Detalle día a día · cuenta · producto» como acordeón,
// igual que Zilonix OS: el día pliega sus cuentas y productos, la
// cuenta pliega sus productos. Arranca con el día más nuevo de la página
// abierto (con todas sus cuentas abiertas) y los demás cerrados. El
// server (DetalleDiaCuentaProducto) calcula todo y pasa datos
// serializables; acá solo vive qué está abierto. Al cambiar de página o
// de filtro el server cambia la `key` y el estado vuelve a empezar.

type Props = {
  encabezados: readonly (string | EncabezadoTabla)[];
  // Fila de grupos encima de los encabezados (vendiste/descuenta/ganaste).
  grupos?: readonly GrupoEncabezado[];
  dias: DiaDetalle[];
  // pedido_id → número de orden de ML, solo de los pedidos de la página.
  pedidoIdExterno: Record<string, string>;
  // Pedidos con reembolsos > 0. Finanzas → Ventas ya no los manda: desde
  // el 28-nov las ventas con reembolso van a «Canceladas y devoluciones».
  conDevolucion?: string[];
};

function diaMasNuevo(dias: DiaDetalle[]): string | null {
  return dias.reduce<string | null>((nuevo, d) => (nuevo === null || d.dia > nuevo ? d.dia : nuevo), null);
}

function plural(n: number, uno: string, varios: string): string {
  return n === 1 ? uno : varios;
}

export function TablaDetalleAcordeon({ encabezados, grupos, dias, pedidoIdExterno, conDevolucion = [] }: Props) {
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
    // scroll: el encabezado queda fijo arriba de la caja al bajar (27-nov).
    // Estilo Zilonix OS (27-nov): el día y la cuenta llevan sus totales por
    // columna (la cuenta resaltada); abajo los productos.
    <Tabla encabezados={encabezados} grupos={grupos} scroll>
      {dias.map((dia) => {
        const diaAbierto = diasAbiertos.has(dia.dia);
        const textoDia = `${fechaDiaLegible(dia.dia)} · ${dia.numero_cuentas} ${plural(dia.numero_cuentas, "cuenta", "cuentas")} · ${dia.numero_ventas} ${plural(dia.numero_ventas, "venta", "ventas")}`;
        return (
          <Fragment key={dia.dia}>
            {/* 27-nov: el día lleva sus totales debajo de cada columna (como
                la cuenta). Con una sola franja y el resumen a la derecha, los
                días cerrados dejaban las columnas vacías y todo amontonado a
                la derecha. */}
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
                  {/* Fecha legible y palabras completas («Vie 27 nov 2026 · 2 cuentas · 12 ventas»). */}
                  <span className={estilos.textoNivel}>
                    <span className={estilos.fechaDia}>{fechaDiaLegible(dia.dia)}</span>
                    <span className={estilos.conteoNivel}>
                      {dia.numero_cuentas} {plural(dia.numero_cuentas, "cuenta", "cuentas")} · {dia.numero_ventas} {plural(dia.numero_ventas, "venta", "ventas")}
                    </span>
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
                            {cuenta.nickname} · {cuenta.numero_ventas} {plural(cuenta.numero_ventas, "venta", "ventas")}
                          </span>
                        </button>
                      </CeldaTabla>
                      <CeldasMontos t={cuenta.totales} costo={cuenta.totales.costo_producto} utilidad={cuenta.totales.utilidad} />
                    </tr>
                    {cuentaAbierta &&
                      cuenta.productos.map((p) => (
                        <tr key={`${p.pedido_id}-${p.linea}`} className={estilos.filaProducto}>
                          <CeldaTabla className={estilos.sangriaProducto}>
                            {/* Bloque de ancho fijo, como Zilonix OS: el título entero
                                en hasta 2 líneas (27-nov; antes 1 línea con «…») y debajo
                                la forma de entrega, el SKU y el número de pedido. Todo
                                se lee entero al pasar el mouse. */}
                            <div
                              className={estilos.lineaProducto}
                              title={`${p.titulo} · ${p.sku_codigo ?? "sin SKU"} · ${ETIQUETA_FORMA[p.forma_entrega]} · #${pedidoIdExterno[p.pedido_id]}`}
                            >
                              {/* 27-nov: el título es texto normal (se puede seleccionar y
                                  copiar); el detalle de la venta se abre desde el número
                                  de pedido. */}
                              <span className={estilos.tituloProducto}>{p.titulo}</span>
                              <div className={estilos.filaDatosProducto}>
                                {/* Etiqueta de entrega con color, como el OS: Full azul,
                                    Flex ámbar, Agencia gris. */}
                                <span className={estilos.chipForma} data-forma={p.forma_entrega}>
                                  {ETIQUETA_FORMA[p.forma_entrega]}
                                </span>
                                {devoluciones.has(p.pedido_id) && (
                                  <Chip estado="peligro" title="Con devolución: revisar">
                                    devolución
                                  </Chip>
                                )}
                                <span className={estilos.datoProducto}>[{p.sku_codigo ? <SkuCopiable sku={p.sku_codigo} comoSpan /> : "sin SKU"}]</span>
                                <Link href={`/panel/finanzas/ventas/${p.pedido_id}`} className={`${estilos.datoProducto} ${estilos.enlacePedido}`} title="Ver el detalle de esta venta">
                                  #{pedidoIdExterno[p.pedido_id]}
                                </Link>
                              </div>
                            </div>
                          </CeldaTabla>
                          <CeldasMontos t={p} costo={p.costo_producto} utilidad={p.utilidad} sku={p.sku_codigo} />
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
