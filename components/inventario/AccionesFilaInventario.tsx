"use client";

import { useState } from "react";
import { Boton } from "@/components/marco/Boton";
import { ModalHistorialProducto } from "./ModalHistorialProducto";
import { ModalModificarProducto, type BodegaModal } from "./ModalModificarProducto";

// Issue #280 — botones de la columna Acciones de /panel/inventario.
// «Historial ingresos» ya no navega a Trazabilidad: abre el emergente
// del producto en esa bodega. «Modificar» solo se pinta si el rol tiene
// inventario.modificar (puedeModificar).
export function AccionesFilaInventario(props: {
  skuId: string;
  codigo: string;
  nombre: string;
  esKit: boolean;
  bodegaId: string | null;
  bodegas: BodegaModal[];
  costo: string | null;
  precioVenta: string | null;
  puedeModificar: boolean;
  veCostos: boolean;
  cambiaCostos: boolean;
  claseContenedor?: string;
}) {
  const [abierto, setAbierto] = useState<"historial" | "modificar" | null>(null);
  const cerrar = () => setAbierto(null);
  return (
    <div className={props.claseContenedor}>
      {!props.esKit && (
        <Boton type="button" variante="secundario" chico onClick={() => setAbierto("historial")}>
          Historial ingresos
        </Boton>
      )}
      {props.puedeModificar && (
        <Boton type="button" variante="secundario" chico onClick={() => setAbierto("modificar")}>
          Modificar
        </Boton>
      )}
      {abierto === "historial" && (
        <ModalHistorialProducto skuId={props.skuId} bodegaId={props.bodegaId} nombre={props.nombre} codigo={props.codigo} onCerrar={cerrar} />
      )}
      {abierto === "modificar" && (
        <ModalModificarProducto
          skuId={props.skuId}
          codigo={props.codigo}
          nombre={props.nombre}
          esKit={props.esKit}
          bodegaId={props.bodegaId}
          bodegas={props.bodegas}
          costo={props.costo}
          precioVenta={props.precioVenta}
          veCostos={props.veCostos}
          cambiaCostos={props.cambiaCostos}
          onCerrar={cerrar}
        />
      )}
    </div>
  );
}
