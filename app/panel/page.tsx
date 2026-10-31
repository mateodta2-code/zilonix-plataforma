import Link from "next/link";
import { requierePermiso, SinPermisoError } from "@/lib/permisos";
import { obtenerContextoPanel } from "@/lib/panel-contexto";
import { detalleVentasDeHoy, formatearVentasDelMes, obtenerKpisPanel } from "@/lib/panel-kpis";
import { leerPublicidadMes, leerTableroMes, leerTableroPorCuenta, leerUtilidadMes } from "@/lib/finanzas/tablero";
import { BloqueInicioFinanzas } from "@/components/finanzas/BloqueInicioFinanzas";
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
//
// Issue #143 — con finanzas.consultar, debajo de los KPI de siempre va
// el bloque de Finanzas del mes (BloqueInicioFinanzas): KPIs,
// participación, comparativo y publicidad por cuenta, como Zilonix OS.
// Sin ese permiso no se lee ni se pinta nada de eso (ni utilidad ni
// publicidad llegan al HTML), y cada lectura de lib/finanzas/tablero.ts
// vuelve a pedir el permiso.
async function puedeConsultarModulo(
  usuarioId: string,
  empresaId: string,
  modulo: "ventas" | "inventario" | "finanzas"
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
  const { usuario, activa } = await obtenerContextoPanel();

  const vePedidosYDespachos = await puedeConsultarModulo(usuario.id, activa.id, "ventas");
  const veSku = await puedeConsultarModulo(usuario.id, activa.id, "inventario");
  const kpis = await obtenerKpisPanel(usuario.id, activa.id);

  const veFinanzas = await puedeConsultarModulo(usuario.id, activa.id, "finanzas");
  let finanzas: React.ComponentProps<typeof BloqueInicioFinanzas> | null = null;
  if (veFinanzas) {
    // Un solo reloj: el mismo tramo en todas las lecturas.
    const ahora = new Date();
    const tablero = await leerTableroMes(activa.id, usuario.id, ahora);
    const utilidad = await leerUtilidadMes(activa.id, usuario.id, ahora, tablero.recaudo.map((r) => r.moneda));
    const publicidad = await leerPublicidadMes(activa.id, usuario.id, ahora);
    const porCuenta = await leerTableroPorCuenta(activa.id, usuario.id, ahora, publicidad);
    finanzas = { tablero, utilidad, porCuenta, publicidad };
  }

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
      {/* Corrección (fix-ui-claro-fade-abajo, punto 5): el saludo
          grande y la tarjetaIdentidad (avatar + nombre + empresa·rol)
          se quitaron de acá — el saludo ahora vive en BarraSuperior
          (visible en toda la sección /panel, no solo en Inicio) y
          tarjetaIdentidad se borró por completo, sin reubicarla: "Mi
          cuenta" sigue en el link del header y en el botón del
          sidebar. Sin dos saludos. */}
      <p className={styles.subtitulo}>Este es el resumen de {activa.nombre}</p>

      <Pestanas pestanas={pestanas} />

      <div className={styles.gridKpi}>
        {vePedidosYDespachos && kpis.ventasDeHoy !== null && (
          <TarjetaKpi titulo="Ventas de hoy" valor={kpis.ventasDeHoy.cantidad} detalle={detalleVentasDeHoy(kpis.ventasDeHoy)} />
        )}
        {vePedidosYDespachos && kpis.ventasDelMes !== null && (
          <TarjetaKpi titulo="Ventas del mes" valor={formatearVentasDelMes(kpis.ventasDelMes)} />
        )}
        {vePedidosYDespachos && kpis.pedidos !== null && <TarjetaKpi titulo="Pedidos" valor={kpis.pedidos} />}
        {vePedidosYDespachos && kpis.despachosPendientes !== null && (
          <TarjetaKpi titulo="Despachos pendientes" valor={kpis.despachosPendientes} />
        )}
        {veSku && kpis.skuSinVincular !== null && <TarjetaKpi titulo="SKU sin vincular" valor={kpis.skuSinVincular} />}
      </div>

      {finanzas && <BloqueInicioFinanzas {...finanzas} />}

      <Link href="/crear-empresa" className={styles.crearEmpresa}>
        {iconoDeClave("crearEmpresa", { size: 16 })}
        + Crear otra empresa
      </Link>
    </>
  );
}
