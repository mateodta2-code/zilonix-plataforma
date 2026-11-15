import { Pestanas } from "@/components/marco/Pestanas";

// Módulo Productos (pedido de Franky, 15-nov): SKU, inventario, bodegas
// y lo que se vaya sumando viven bajo un solo ítem del menú, con estas
// pestañas arriba de cada pantalla. Las rutas siguen siendo las de cada
// pantalla (no se movió nada a /panel/productos): para sumar una
// pestaña, se agrega aquí y en `rutasExtra` del ítem en
// app/panel/layout.tsx si su ruta no cuelga de las que ya están.
//
// Todas piden ("inventario","consultar"), el mismo permiso con el que
// se ve el ítem. Una pestaña nueva con otro permiso tiene que filtrarse
// acá antes de mostrarse.
export const PESTANAS_PRODUCTOS = [
  { href: "/panel/inventario", etiqueta: "Inventario" },
  { href: "/panel/sku", etiqueta: "SKU" },
  { href: "/panel/bodegas", etiqueta: "Bodegas" },
  { href: "/panel/inventario/kardex", etiqueta: "Kardex" },
  { href: "/panel/inventario/ingresos", etiqueta: "Ingresos" },
  { href: "/panel/inventario/compras", etiqueta: "Compras" },
  { href: "/panel/inventario/configuracion", etiqueta: "Configuración" },
] as const;

export type PestanaProductos = (typeof PESTANAS_PRODUCTOS)[number]["href"];

// `actual` la pasa cada página (las subpáginas, como el detalle de una
// OC o importar SKU, pasan la de su sección).
export function PestanasProductos({ actual }: { actual: PestanaProductos }) {
  return <Pestanas pestanas={PESTANAS_PRODUCTOS.map((p) => ({ etiqueta: p.etiqueta, href: p.href, activa: p.href === actual }))} />;
}
