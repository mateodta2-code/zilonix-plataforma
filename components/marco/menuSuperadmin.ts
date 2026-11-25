import type { GrupoNav } from "./tipos";

// Menú del superadmin dentro del marco. Solo rutas de /superadmin: nunca
// un ítem del vendedor (pedidos, productos, finanzas…).
export function gruposSuperadmin(): GrupoNav[] {
  return [
    {
      items: [
        { etiqueta: "Inicio", href: "/superadmin", icono: "inicio" },
        { etiqueta: "Empresas", href: "/superadmin/empresas", icono: "empresas" },
        { etiqueta: "Conexiones", href: "/superadmin/conexiones", icono: "conectarMl" },
        { etiqueta: "Procesos", href: "/superadmin/procesos", icono: "actividad" },
        { etiqueta: "Anuncios", href: "/superadmin/anuncios", icono: "avisosMl" },
        { etiqueta: "Bodegas", href: "/superadmin/bodegas", icono: "bodegas" },
        { etiqueta: "Moderar foro", href: "/superadmin/foro", icono: "foro" },
        { etiqueta: "Soporte", href: "/superadmin/soporte", icono: "soporte" },
        { etiqueta: "Métricas", href: "/superadmin/metricas", icono: "metricas" },
      ],
    },
    {
      etiqueta: "Administración",
      items: [
        { etiqueta: "Equipo superadmin", href: "/superadmin/equipo", icono: "equipoAdmin" },
        { etiqueta: "Auditoría", href: "/superadmin/auditoria", icono: "auditoria" },
        { etiqueta: "Configuración", href: "/superadmin/configuracion", icono: "configuracion" },
      ],
    },
  ];
}
