import type { GrupoNav } from "./tipos";
import type { RolBodega } from "@/lib/bodega/roles";

const PROXIMAMENTE = { deshabilitada: true, titulo: "Próximamente" } as const;

// Menú del panel de BODEGA (admin_bodega y operario). ADMINISTRACIÓN solo
// para admin_bodega. Nunca ítems del vendedor.
export function gruposBodega(rol: RolBodega): GrupoNav[] {
  const grupos: GrupoNav[] = [
    {
      items: [
        { etiqueta: "Inicio", href: "/bodega", icono: "inicio" },
        { etiqueta: "Recepción", href: "/bodega/recepcion", icono: "pedidos", ...PROXIMAMENTE },
        { etiqueta: "Inventario", href: "/bodega/inventario", icono: "inventario", ...PROXIMAMENTE },
        { etiqueta: "Despachos", href: "/bodega/despachos", icono: "despachos", ...PROXIMAMENTE },
        { etiqueta: "Domiciliarios", href: "/bodega/domiciliarios", icono: "personas" },
      ],
    },
  ];
  if (rol === "admin_bodega") {
    grupos.push({
      etiqueta: "Administración",
      items: [
        { etiqueta: "Invitar persona", href: "/bodega/invitar", icono: "invitar" },
        { etiqueta: "Personas", href: "/bodega/personas", icono: "personas" },
        { etiqueta: "Permisos", href: "/bodega/permisos", icono: "roles" },
        { etiqueta: "Configuración", href: "/bodega/configuracion", icono: "configuracion" },
      ],
    });
  }
  return grupos;
}

// Panel del DOMICILIARIO (celular primero): lo mínimo.
export function gruposDomiciliario(): GrupoNav[] {
  return [
    {
      items: [
        { etiqueta: "Inicio", href: "/domiciliario", icono: "inicio" },
        { etiqueta: "Mis entregas", href: "/domiciliario/entregas", icono: "despachos", ...PROXIMAMENTE },
      ],
    },
  ];
}
