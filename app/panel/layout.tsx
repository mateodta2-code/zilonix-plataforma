import { tienePermiso } from "@/lib/roles";
import { obtenerContextoPanel } from "@/lib/panel-contexto";
import { MarcoApp } from "@/components/marco/MarcoApp";
import type { GrupoNav } from "@/components/marco/tipos";

// Marco visual (issue de las subpáginas) — mueve acá la carga que
// antes hacía SOLO app/panel/page.tsx para pintar el marco (usuario
// actual, empresa activa por cookie, membresía, ítems de navegación
// filtrados por permiso). Mismas redirecciones de siempre (/sign-in,
// /crear-empresa) — nunca lógica nueva, solo se movió de dónde vivía,
// para que TODA la sección /panel tenga la barra lateral y la barra
// superior, no solo /panel en sí.
//
// Este layout NO reemplaza requierePermiso(...) de cada subpágina:
// cada una sigue protegiéndose sola (tarea 1.8). Acá solo se decide
// qué mostrar en el menú — la misma regla tienePermiso(..., "consultar")
// de siempre, nunca una pregunta de autorización nueva.
//
// app/panel/page.tsx necesita estos mismos datos para SU propio
// contenido (el saludo, la tarjeta de identidad, los KPIs) —
// obtenerContextoPanel() (lib/panel-contexto.ts) usa cache() de React
// para que layout y page, pintándose juntos en la misma petición, hagan
// esta consulta UNA sola vez en vez de dos.
export default async function PanelLayout({ children }: { children: React.ReactNode }) {
  const { usuario, propias, activa, permisos, rolNombre, clerkUser } = await obtenerContextoPanel();
  const esDueno = rolNombre === "Dueño";

  const vePedidosYDespachos = tienePermiso(permisos, "ventas", "consultar");
  const veSku = tienePermiso(permisos, "inventario", "consultar");
  const veFinanzas = tienePermiso(permisos, "finanzas", "consultar");
  const veActividad = tienePermiso(permisos, "configuracion", "consultar");

  const grupoPrincipal: GrupoNav = {
    items: [
      { etiqueta: "Inicio", href: "/panel", icono: "inicio" },
      ...(vePedidosYDespachos
        ? [
            { etiqueta: "Pedidos", href: "/panel/pedidos", icono: "pedidos" as const },
            { etiqueta: "Despachos", href: "/panel/despachos", icono: "despachos" as const },
          ]
        : []),
      ...(veSku ? [{ etiqueta: "SKU", href: "/panel/sku", icono: "sku" as const }] : []),
      ...(veFinanzas ? [{ etiqueta: "Finanzas", href: "/panel/finanzas", icono: "finanzas" as const }] : []),
      ...(veActividad ? [{ etiqueta: "Actividad", href: "/panel/actividad", icono: "actividad" as const }] : []),
      { etiqueta: "Personas", href: "#", icono: "personas", deshabilitada: true, titulo: "Próximamente" },
    ],
  };

  // Tarea 2.3/1.7 — mismos 5 links que antes vivían sueltos abajo de
  // la página, solo para el Dueño. Acá se agrupan como "Administración"
  // en la barra lateral, en vez de una fila de texto.
  const grupos: GrupoNav[] = esDueno
    ? [
        grupoPrincipal,
        {
          etiqueta: "Administración",
          items: [
            { etiqueta: "Invitar persona", href: "/panel/invitar", icono: "invitar" },
            { etiqueta: "Ajustar roles", href: "/panel/roles", icono: "roles" },
            { etiqueta: "Acceso de soporte", href: "/panel/soporte", icono: "soporte" },
            { etiqueta: "Conectar Mercado Libre", href: "/panel/conectar-ml", icono: "conectarMl" },
            { etiqueta: "Avisos de Mercado Libre", href: "/panel/avisos-ml", icono: "avisosMl" },
          ],
        },
      ]
    : [grupoPrincipal];

  return (
    <MarcoApp
      empresa={{ nombre: activa.nombre, nit: activa.nit }}
      empresaActivaId={activa.id}
      empresasPropias={propias}
      rol={rolNombre}
      grupos={grupos}
      usuario={{ nombre: usuario.nombre, imagenUrl: clerkUser?.imageUrl ?? null }}
      mostrarCampana={esDueno}
    >
      {children}
    </MarcoApp>
  );
}
