import Link from "next/link";
import { requierePermiso, SinPermisoError } from "@/lib/permisos";
import { obtenerContextoPanel } from "@/lib/panel-contexto";
import { formatearVentasDelMes, obtenerKpisPanel } from "@/lib/panel-kpis";
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
// propio contenido (saludo, tarjeta de identidad, pestañas, KPIs).
//
// obtenerContextoPanel() (lib/panel-contexto.ts) es la misma consulta
// que ya pidió app/panel/layout.tsx para pintar el marco — cache() de
// React hace que, dentro de esta misma petición, solo se consulte la
// base una vez entre los dos.

// scripts/verificar-permisos.test.ts lee el TEXTO de este archivo y
// exige `requierePermiso(` — no sigue el import hasta lib/panel-kpis.ts,
// donde obtenerKpisPanel vuelve a hacer la misma pregunta (y es lo que
// cubre la prueba contra Postgres). Las dos tienen que atrapar solo
// SinPermisoError: /panel es el resumen, un rol sin "ventas" igual
// entra y simplemente no ve esas pestañas ni esas cifras. Un error de
// verdad (la base no responde, un id mal formado) sí tiene que subir.
async function puedeConsultarModulo(
  usuarioId: string,
  empresaId: string,
  modulo: "ventas" | "inventario"
): Promise<boolean> {
  try {
    await requierePermiso(usuarioId, empresaId, modulo, "consultar");
    return true;
  } catch (error) {
    if (error instanceof SinPermisoError) return false;
    throw error;
  }
}

export default async function PanelPage() {
  const { usuario, activa, rolNombre, clerkUser } = await obtenerContextoPanel();

  const vePedidosYDespachos = await puedeConsultarModulo(usuario.id, activa.id, "ventas");
  const veSku = await puedeConsultarModulo(usuario.id, activa.id, "inventario");
  const kpis = await obtenerKpisPanel(usuario.id, activa.id);

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
          {/* Corrección (fix-ui-claro-como-oscuro): sin zx-texto-plata,
              mismo motivo que EncabezadoPagina.tsx — este saludo cae
              siempre en la franja oscura del degradado, en los dos
              temas; .saludo trae su propio degradado plata de zona
              oscura directo en page.module.css. */}
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
        {vePedidosYDespachos && kpis.ventasDelMes !== null && (
          <TarjetaKpi titulo="Ventas del mes" valor={formatearVentasDelMes(kpis.ventasDelMes)} />
        )}
        {vePedidosYDespachos && kpis.pedidos !== null && <TarjetaKpi titulo="Pedidos" valor={kpis.pedidos} />}
        {vePedidosYDespachos && kpis.despachosPendientes !== null && (
          <TarjetaKpi titulo="Despachos pendientes" valor={kpis.despachosPendientes} />
        )}
        {veSku && kpis.skuSinVincular !== null && <TarjetaKpi titulo="SKU sin vincular" valor={kpis.skuSinVincular} />}
      </div>

      <Link href="/crear-empresa" className={styles.crearEmpresa}>
        {iconoDeClave("crearEmpresa", { size: 16 })}
        + Crear otra empresa
      </Link>
    </>
  );
}
