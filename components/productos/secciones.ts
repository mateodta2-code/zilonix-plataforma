import type { SubitemNav } from "@/components/marco/tipos";

// Módulo Productos (pedido de Franky, 15-nov): SKU, inventario, bodegas
// y lo que se vaya sumando se despliegan bajo el ítem "Productos" del
// menú lateral. Las rutas siguen siendo las de cada pantalla (nada se
// movió a /panel/productos). Para sumar una sección, se agrega una
// línea acá.
//
// Todas piden ("inventario","consultar"), el mismo permiso con el que
// se ve el ítem (app/panel/layout.tsx). Una sección nueva con otro
// permiso tiene que filtrarse en el layout antes de mostrarse.
export const SECCIONES_PRODUCTOS: SubitemNav[] = [
  { etiqueta: "Inventario", href: "/panel/inventario" },
  { etiqueta: "SKU", href: "/panel/sku" },
  { etiqueta: "Bodegas", href: "/panel/bodegas" },
  { etiqueta: "Kardex", href: "/panel/inventario/kardex" },
  { etiqueta: "Ingresos", href: "/panel/inventario/ingresos" },
  { etiqueta: "Compras", href: "/panel/inventario/compras" },
  { etiqueta: "Configuración", href: "/panel/inventario/configuracion" },
];
