import { cookies } from "next/headers";
import Link from "next/link";
import { redirect } from "next/navigation";
import { currentUser } from "@clerk/nextjs/server";
import { listarEmpresasDeUsuario } from "@/lib/empresas";
import { obtenerMiMembresia } from "@/lib/membresias";
import { obtenerOCrearUsuarioActual } from "@/lib/usuarios";
import { tienePermiso } from "@/lib/roles";
import { MarcoApp } from "@/components/marco/MarcoApp";
import { Pestanas, type Pestana } from "@/components/marco/Pestanas";
import { TarjetaKpi } from "@/components/marco/TarjetaKpi";
import { iconoDeClave } from "@/components/marco/iconos";
import type { GrupoNav } from "@/components/marco/tipos";
import styles from "./page.module.css";

// Tarea 1.6 — pantalla mínima que prueba el criterio de "listo": con un
// usuario en 2 empresas, al cambiar ves datos distintos (acá, el nombre
// y el NIT de la empresa activa) y nunca mezclados. Las pantallas de
// negocio de verdad (ventas, inventario) llegan en la Fase 2.
//
// Tarea 1.7 — los módulos del nav se filtran por lo que el rol de esta
// persona puede consultar (ej. el Operador no ve "finanzas").
//
// Marco visual (issue del marco del panel) — MISMA lógica de servidor
// de siempre; lo único que cambia es que ahora se pinta con
// components/marco/ (MarcoApp + barra lateral/superior con identidad
// propia negro/plateado/azul) en vez del <main> suelto de antes. Todos
// los links que ya existían siguen existiendo, solo que algunos se
// movieron a la barra lateral (Administración) o a la barra superior
// (cambiar de empresa) — ver el fragmento de changelog para el detalle
// completo de qué se movió y qué queda para otro PR (subrutas,
// app/panel/layout.tsx).
export default async function PanelPage() {
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

  // Solo para el avatar (imagenUrl) — obtenerOCrearUsuarioActual() ya
  // guarda el nombre en NUESTRA tabla usuarios, así que el nombre que
  // se muestra sale de ahí, no de Clerk otra vez.
  const clerkUser = await currentUser();

  const vePedidosYDespachos = tienePermiso(permisos, "ventas", "consultar");
  const veSku = tienePermiso(permisos, "inventario", "consultar");
  const veFinanzas = tienePermiso(permisos, "finanzas", "consultar");
  const veActividad = tienePermiso(permisos, "configuracion", "consultar");

  const grupoPrincipal: GrupoNav = {
    items: [
      { etiqueta: "Inicio", href: "/panel", icono: "inicio", activa: true },
      ...(vePedidosYDespachos
        ? [
            { etiqueta: "Pedidos", href: "/panel/pedidos", icono: "pedidos" as const, activa: false },
            { etiqueta: "Despachos", href: "/panel/despachos", icono: "despachos" as const, activa: false },
          ]
        : []),
      ...(veSku ? [{ etiqueta: "SKU", href: "/panel/sku", icono: "sku" as const, activa: false }] : []),
      ...(veFinanzas ? [{ etiqueta: "Finanzas", href: "/panel/finanzas", icono: "finanzas" as const, activa: false }] : []),
      ...(veActividad ? [{ etiqueta: "Actividad", href: "/panel/actividad", icono: "actividad" as const, activa: false }] : []),
      { etiqueta: "Personas", href: "#", icono: "personas", activa: false, deshabilitada: true, titulo: "Próximamente" },
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
            { etiqueta: "Invitar persona", href: "/panel/invitar", icono: "invitar", activa: false },
            { etiqueta: "Ajustar roles", href: "/panel/roles", icono: "roles", activa: false },
            { etiqueta: "Acceso de soporte", href: "/panel/soporte", icono: "soporte", activa: false },
            { etiqueta: "Conectar Mercado Libre", href: "/panel/conectar-ml", icono: "conectarMl", activa: false },
            { etiqueta: "Avisos de Mercado Libre", href: "/panel/avisos-ml", icono: "avisosMl", activa: false },
          ],
        },
      ]
    : [grupoPrincipal];

  const pestanas: Pestana[] = [
    { etiqueta: "Resumen", href: "/panel", activa: true },
    ...(vePedidosYDespachos
      ? [
          { etiqueta: "Pedidos", href: "/panel/pedidos", activa: false },
          { etiqueta: "Despachos", href: "/panel/despachos", activa: false },
        ]
      : []),
    ...(veSku ? [{ etiqueta: "SKU", href: "/panel/sku", activa: false }] : []),
  ];

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
      <div className={styles.encabezado}>
        <div>
          <h1 className={styles.saludo}>Hola, {usuario.nombre}</h1>
          <p className={styles.subtitulo}>Este es el resumen de {activa.nombre}</p>
        </div>

        <div className={styles.tarjetaIdentidad}>
          {clerkUser?.imageUrl ? (
            // eslint-disable-next-line @next/next/no-img-element -- la
            // app no usa next/image a propósito, ver BarraSuperior.tsx.
            <img src={clerkUser.imageUrl} alt="" width={44} height={44} className={styles.avatarIdentidad} />
          ) : (
            <span className={styles.avatarIdentidadRespaldo}>{usuario.nombre.slice(0, 1).toUpperCase()}</span>
          )}
          <div>
            <p className={styles.nombreIdentidad}>{usuario.nombre}</p>
            <p className={styles.empresaRolIdentidad}>
              {activa.nombre} · {rolNombre}
            </p>
          </div>
        </div>
      </div>

      <Pestanas pestanas={pestanas} />

      <div className={styles.gridKpi}>
        <TarjetaKpi titulo="Ventas del mes" />
        <TarjetaKpi titulo="Pedidos" />
        <TarjetaKpi titulo="Despachos pendientes" />
        <TarjetaKpi titulo="SKU sin vincular" />
      </div>

      <Link href="/crear-empresa" className={styles.crearEmpresa}>
        {iconoDeClave("crearEmpresa", { size: 16 })}
        + Crear otra empresa
      </Link>
    </MarcoApp>
  );
}
