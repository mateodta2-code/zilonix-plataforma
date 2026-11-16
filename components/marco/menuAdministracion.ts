import { tienePermiso } from "@/lib/roles-plantillas";
import type { ItemNav } from "./tipos";

// Tarea 2.3/1.7 — links del grupo "Administración" de la barra lateral
// (app/panel/layout.tsx). Cada link sale con el mismo permiso que pide
// su página (requierePermiso en app/panel/invitar, roles, soporte,
// conectar-ml y avisos-ml): si una página cambia de permiso, este
// cambio va con ella.
export function itemsAdministracion(permisos: { modulo: string; accion: string }[]): ItemNav[] {
  return [
    ...(tienePermiso(permisos, "personas", "crear") ? [{ etiqueta: "Invitar persona", href: "/panel/invitar", icono: "invitar" as const }] : []),
    ...(tienePermiso(permisos, "configuracion", "autorizar")
      ? [
          { etiqueta: "Ajustar roles", href: "/panel/roles", icono: "roles" as const },
          { etiqueta: "Acceso de soporte", href: "/panel/soporte", icono: "soporte" as const },
        ]
      : []),
    ...(tienePermiso(permisos, "configuracion", "consultar")
      ? [
          // Pedido de Sharel/Pablo (15/11): la pantalla ya no es solo
          // Mercado Libre, unifica los dos canales (ver conector
          // Falabella) — ruta y permiso sin cambios, solo la etiqueta.
          { etiqueta: "Conectar marketplaces", href: "/panel/conectar-ml", icono: "conectarMl" as const },
          { etiqueta: "Avisos de Mercado Libre", href: "/panel/avisos-ml", icono: "avisosMl" as const },
        ]
      : []),
  ];
}
