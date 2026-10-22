import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { currentUser } from "@clerk/nextjs/server";
import { listarEmpresasDeUsuario } from "@/lib/empresas";
import { obtenerMiMembresia } from "@/lib/membresias";
import { obtenerOCrearUsuarioActual } from "@/lib/usuarios";
import { tienePermiso } from "@/lib/roles";
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
// Next.js no comparte variables entre un layout y lo que tiene
// adentro: app/panel/page.tsx necesita estos mismos datos para SU
// propio contenido (el saludo, la tarjeta de identidad) y los vuelve
// a pedir — a propósito, son lecturas de una sola fila cada una, no
// una consulta pesada que valga la pena memoizar para esta tarea.
export default async function PanelLayout({ children }: { children: React.ReactNode }) {
  const usuario = await obtenerOCrearUsuarioActual();
  if (!usuario) redirect("/sign-in");

  const propias = await listarEmpresasDeUsuario(usuario.id);
  if (propias.length === 0) redirect("/crear-empresa");

  const cookieEmpresa = cookies().get("empresa_actual")?.value;
  const activa = propias.find((e) => e.id === cookieEmpresa) ?? propias[0];
  const miMembresia = await obtenerMiMembresia(usuario.id, activa.id);
  const permisos = miMembresia?.permisos ?? [];
  const rolNombre = miMembresia?.rolNombre ?? "sin rol";
  const esDueno = rolNombre === "Dueño";

  const clerkUser = await currentUser();

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
