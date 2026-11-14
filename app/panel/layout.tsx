import { tienePermiso } from "@/lib/roles";
import { obtenerContextoPanel } from "@/lib/panel-contexto";
import { MarcoApp } from "@/components/marco/MarcoApp";
import type { GrupoNav } from "@/components/marco/tipos";
import { itemsAdministracion } from "@/components/marco/menuAdministracion";

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
  const vePublicidad = tienePermiso(permisos, "publicidad", "consultar");
  const vePromociones = tienePermiso(permisos, "promociones", "consultar");
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
      // Issue #280 — WMS Fase 1, mismo permiso que SKU.
      ...(veSku
        ? [
            { etiqueta: "Inventario", href: "/panel/inventario", icono: "inventario" as const },
            { etiqueta: "Bodegas", href: "/panel/bodegas", icono: "bodegas" as const },
          ]
        : []),
      // Mismo permiso que SKU ("inventario","consultar") — Investigación
      // también decide qué traer/revender, no vende ni despacha nada.
      ...(veSku ? [{ etiqueta: "Investigación", href: "/panel/investigacion", icono: "investigacion" as const }] : []),
      // ADENDO UX de Publicar, punto 1 — mismo permiso que ya exige
      // app/panel/publicar/page.tsx ("inventario","consultar") —
      // sin grupos de empresa hardcodeados: cualquier empresa con ese
      // permiso ve el ítem, nunca una lista fija de nombres.
      ...(veSku ? [{ etiqueta: "Publicar", href: "/panel/publicar", icono: "publicar" as const }] : []),
      // Rama fix-promociones-permisos-dueno — movida a justo debajo de
      // "Publicar" (antes vivía después de Publicidad): mismo permiso
      // de módulo de siempre ("promociones","consultar"), sin ninguna
      // lista fija de cuentas/empresas; solo cambia el orden en el menú.
      ...(vePromociones ? [{ etiqueta: "Promociones", href: "/panel/promociones", icono: "promociones" as const }] : []),
      ...(veFinanzas ? [{ etiqueta: "Finanzas", href: "/panel/finanzas", icono: "finanzas" as const }] : []),
      ...(vePublicidad ? [{ etiqueta: "Publicidad", href: "/panel/publicidad", icono: "publicidad" as const }] : []),
      ...(veActividad ? [{ etiqueta: "Actividad", href: "/panel/actividad", icono: "actividad" as const }] : []),
      // Rama feat-promociones, punto 6 — "Conexión de IA" vive en
      // Configuración, mismo permiso que Actividad (ambos leen
      // "configuracion","consultar"). Primera pantalla real bajo este
      // módulo.
      ...(veActividad ? [{ etiqueta: "Configuración", href: "/panel/configuracion", icono: "configuracion" as const }] : []),
      // Issue #370 — Personas (miembros, invitaciones, cambiar rol), mismo
      // permiso que pide la página ("personas","consultar").
      ...(tienePermiso(permisos, "personas", "consultar") ? [{ etiqueta: "Personas", href: "/panel/personas", icono: "personas" as const }] : []),
    ],
  };

  // Tarea 2.3/1.7 — los 5 links de "Administración". Antes salían solo
  // si el rol se llamaba "Dueño", aunque cada página ya pide su propio
  // permiso (tarea 1.8): un Gerente con esos permisos no veía el menú
  // (Sharel, 13-nov). Ahora cada link sale con el MISMO permiso que
  // exige su página, y el grupo solo si queda alguno.
  const administracion = itemsAdministracion(permisos);
  const grupos: GrupoNav[] =
    administracion.length > 0 ? [grupoPrincipal, { etiqueta: "Administración", items: administracion }] : [grupoPrincipal];

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

