import type { SubitemNav } from "@/components/marco/tipos";
import { tienePermiso } from "@/lib/roles-plantillas";

// Módulo Finanzas en el menú lateral: se despliega igual que Productos
// (components/productos/secciones.ts, mismo ItemNavLink). Las rutas
// siguen siendo las de cada pantalla; los botones de /panel/finanzas
// no se tocan.
//
// Cada sección declara el permiso que exige su página con
// requierePermiso(...) — secciones.test.ts lo compara contra el
// page.tsx real, así que si una página cambia de permiso la prueba
// avisa antes de que el menú muestre algo que la página niega.
type SeccionFinanzas = SubitemNav & { accion: "consultar" | "modificar" };

export const SECCIONES_FINANZAS: SeccionFinanzas[] = [
  { etiqueta: "Resumen", href: "/panel/finanzas", accion: "consultar" },
  { etiqueta: "Ventas y utilidad", href: "/panel/finanzas/ventas", accion: "consultar" },
  { etiqueta: "Disponible", href: "/panel/finanzas/disponible", accion: "consultar" },
  { etiqueta: "Por cobrar", href: "/panel/finanzas/por-cobrar", accion: "consultar" },
  { etiqueta: "Gastos", href: "/panel/finanzas/gastos", accion: "consultar" },
  { etiqueta: "Inventario", href: "/panel/finanzas/inventario", accion: "consultar" },
  { etiqueta: "Conciliación Falabella", href: "/panel/finanzas/falabella", accion: "consultar" },
  { etiqueta: "Tabla maestra de SKU", href: "/panel/finanzas/maestra-sku", accion: "consultar" },
  { etiqueta: "Proveedores", href: "/panel/finanzas/proveedores", accion: "consultar" },
  { etiqueta: "Configuración", href: "/panel/finanzas/configuracion", accion: "consultar" },
];

// Solo las secciones cuya página dejaría entrar a este rol.
export function seccionesFinanzas(permisos: { modulo: string; accion: string }[]): SubitemNav[] {
  return SECCIONES_FINANZAS.filter((s) => tienePermiso(permisos, "finanzas", s.accion)).map(({ etiqueta, href }) => ({ etiqueta, href }));
}
