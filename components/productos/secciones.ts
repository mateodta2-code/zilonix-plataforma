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
//
// Orden y nombres pedidos para el módulo (issue #280): Bodegas, Ingresos
// y Configuración salieron del menú pero sus pantallas siguen abriendo
// por URL (y desde los enlaces que ya las llaman). Compras y Kardex solo
// cambiaron de nombre: las rutas quedan igual para no romper enlaces
// (la tabla de Inventario lleva a /panel/inventario/kardex?sku=…).
// Devoluciones, Inventario Full y Proyección están en construcción.
export const SECCIONES_PRODUCTOS: SubitemNav[] = [
  { etiqueta: "Registro de compras", href: "/panel/inventario/compras" },
  { etiqueta: "Inventario", href: "/panel/inventario" },
  { etiqueta: "Trazabilidad de inventario", href: "/panel/inventario/kardex" },
  { etiqueta: "Devoluciones", href: "/panel/inventario/devoluciones" },
  { etiqueta: "Inventario Full", href: "/panel/inventario/full" },
  { etiqueta: "Proyección de inventarios", href: "/panel/inventario/proyeccion" },
  { etiqueta: "SKU", href: "/panel/sku" },
];
