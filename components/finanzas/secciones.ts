import type { SubitemNav } from "@/components/marco/tipos";
import { tienePermiso } from "@/lib/roles-plantillas";

// Módulo Finanzas en el menú lateral: se despliega igual que Productos
// (components/productos/secciones.ts, mismo ItemNavLink). Las rutas
// siguen siendo las de cada pantalla.
//
// Pedido de Sharel (2026-11-28): sin «Resumen» (sus cifras ya están en
// Inicio; /panel/finanzas solo redirige a Ventas y utilidad);
// Conciliación Falabella se entra desde Por cobrar (pocas empresas
// venden en Falabella y abultaba el menú) y Proveedores desde
// Configuración. Sus pantallas siguen en las mismas rutas: van en
// otrasRutas para que el menú marque la sección de la que cuelgan.
//
// Cada sección declara el permiso que exige su página con
// requierePermiso(...) — secciones.test.ts lo compara contra el
// page.tsx real, así que si una página cambia de permiso la prueba
// avisa antes de que el menú muestre algo que la página niega.
type SeccionFinanzas = SubitemNav & { accion: "consultar" | "modificar" };

export const SECCIONES_FINANZAS: SeccionFinanzas[] = [
  { etiqueta: "Ventas y utilidad", href: "/panel/finanzas/ventas", accion: "consultar" },
  { etiqueta: "Disponible", href: "/panel/finanzas/disponible", accion: "consultar" },
  { etiqueta: "Por cobrar", href: "/panel/finanzas/por-cobrar", accion: "consultar", otrasRutas: ["/panel/finanzas/falabella"] },
  { etiqueta: "Por pagar", href: "/panel/finanzas/por-pagar", accion: "consultar" },
  { etiqueta: "Gastos", href: "/panel/finanzas/gastos", accion: "consultar" },
  { etiqueta: "Inversión en inventario", href: "/panel/finanzas/inventario", accion: "consultar" },
  { etiqueta: "Tabla maestra de SKU", href: "/panel/finanzas/maestra-sku", accion: "consultar" },
  { etiqueta: "Configuración", href: "/panel/finanzas/configuracion", accion: "consultar", otrasRutas: ["/panel/finanzas/proveedores"] },
];

// Solo las secciones cuya página dejaría entrar a este rol.
export function seccionesFinanzas(permisos: { modulo: string; accion: string }[]): SubitemNav[] {
  return SECCIONES_FINANZAS.filter((s) => tienePermiso(permisos, "finanzas", s.accion)).map(({ etiqueta, href, otrasRutas }) => (otrasRutas ? { etiqueta, href, otrasRutas } : { etiqueta, href }));
}
