import { cookies } from "next/headers";
import Link from "next/link";
import { redirect } from "next/navigation";
import { currentUser } from "@clerk/nextjs/server";
import { listarEmpresasDeUsuario } from "@/lib/empresas";
import { obtenerMiMembresia } from "@/lib/membresias";
import { obtenerOCrearUsuarioActual } from "@/lib/usuarios";
import { tienePermiso } from "@/lib/roles";
import { Pestanas, type Pestana } from "@/components/marco/Pestanas";
import { TarjetaKpi } from "@/components/marco/TarjetaKpi";
import { iconoDeClave } from "@/components/marco/iconos";
import styles from "./page.module.css";

// Tarea 1.6 — pantalla mínima que prueba el criterio de "listo": con un
// usuario en 2 empresas, al cambiar ves datos distintos (acá, el nombre
// y el NIT de la empresa activa) y nunca mezclados. Las pantallas de
// negocio de verdad (ventas, inventario) llegan en la Fase 2.
//
// Tarea 1.7 — las pestañas se filtran por lo que el rol de esta
// persona puede consultar (ej. el Operador no ve "Finanzas").
//
// Marco visual (issue de las subpáginas) — el marco (barra lateral +
// barra superior) ya no se pinta acá: lo pone app/panel/layout.tsx,
// que envuelve TODA la sección /panel. Esta página queda solo con su
// propio contenido (saludo, tarjeta de identidad, pestañas, KPIs
// vacíos) — vuelve a pedir usuario/empresa/membresía porque Next.js
// no comparte variables entre un layout y lo que tiene adentro (mismo
// criterio documentado en el layout).
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

  const clerkUser = await currentUser();

  const vePedidosYDespachos = tienePermiso(permisos, "ventas", "consultar");
  const veSku = tienePermiso(permisos, "inventario", "consultar");

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
    <>
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
    </>
  );
}
