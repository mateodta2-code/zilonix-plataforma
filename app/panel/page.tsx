import Link from "next/link";
import { requierePermiso, SinPermisoError } from "@/lib/permisos";
import { obtenerContextoPanel } from "@/lib/panel-contexto";
import { detalleVentasDeHoy, formatearVentasDelMes, obtenerKpisPanel } from "@/lib/panel-kpis";
import { normalizarParametro } from "@/lib/filtros-listado";
import { leerIndicadores, tramoDeFechas, tramoDeHoy } from "@/lib/finanzas/indicadores";
import { leerMetaDelMes } from "@/lib/finanzas/meta-mes";
import { leerTableroMes, tramosBogota } from "@/lib/finanzas/tablero";
import { tienePermiso } from "@/lib/roles";
import { InicioFinanzas } from "@/components/finanzas/InicioFinanzas";
import { ChecklistOnboarding } from "@/components/panel/ChecklistOnboarding";
import { TarjetaKpi } from "@/components/marco/TarjetaKpi";
import { iconoDeClave } from "@/components/marco/iconos";
import styles from "./page.module.css";

// Tarea 1.6 — pantalla mínima que prueba el criterio de "listo": con un
// usuario en 2 empresas, al cambiar ves datos distintos (acá, el nombre
// y el NIT de la empresa activa) y nunca mezclados. Las pantallas de
// negocio de verdad (ventas, inventario) llegan en la Fase 2.
//
// Tarea 1.7 — las tarjetas se filtran por lo que el rol de esta
// persona puede consultar (ej. el Operador no ve "Finanzas"). Las
// pestañas Resumen · Pedidos · Despachos · SKU que había acá se
// quitaron (pedido del equipo, 13-nov): repetían links que ya están en
// la barra lateral. La tarjeta «Pedidos» también salió (Sharel, 13-nov):
// contaba TODOS los pedidos guardados desde siempre, con cancelados, y
// confundía al lado de «Número de ventas».
//
// Marco visual (issue de las subpáginas) — el marco (barra lateral +
// barra superior) ya no se pinta acá: lo pone app/panel/layout.tsx,
// que envuelve TODA la sección /panel. Esta página queda solo con su
// propio contenido (saludo, tarjeta de identidad, KPIs).
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
// entra y simplemente no ve esas cifras. Un error de
// verdad (la base no responde, un id mal formado) sí tiene que subir.
//
// Issue #143 — con finanzas.consultar, Inicio es el tablero del negocio
// (Sharel y el equipo, 13-nov; components/finanzas/InicioFinanzas.tsx):
// arriba los indicadores de HOY, en la mitad la meta del mes con su
// avance en utilidad después de publicidad, y abajo los mismos
// indicadores del mes en curso o del rango del filtro (?desde=&hasta=,
// hasta 31 días), con las gráficas por cuenta y la operación (pedidos,
// despachos, SKU). Sin ese permiso Inicio queda con las tarjetas de
// siempre y no se lee ni se pinta nada de finanzas; cada lectura de
// lib/finanzas/ vuelve a pedir el permiso.
async function puedeConsultarModulo(
  usuarioId: string,
  empresaId: string,
  modulo: "ventas" | "inventario" | "finanzas" | "configuracion"
): Promise<boolean> {
  try {
    await requierePermiso(usuarioId, empresaId, modulo, "consultar");
    return true;
  } catch (error) {
    if (error instanceof SinPermisoError) return false;
    throw error;
  }
}

export default async function PanelPage({ searchParams = {} }: { searchParams?: Record<string, string | string[] | undefined> }) {
  const { usuario, activa, rolNombre, permisos } = await obtenerContextoPanel();

  const vePedidosYDespachos = await puedeConsultarModulo(usuario.id, activa.id, "ventas");
  const veSku = await puedeConsultarModulo(usuario.id, activa.id, "inventario");
  const kpis = await obtenerKpisPanel(usuario.id, activa.id);

  const veFinanzas = await puedeConsultarModulo(usuario.id, activa.id, "finanzas");
  // Issue #323 — /panel/conectar-ml pide configuracion.consultar y
  // /panel/pedidos pide ventas.consultar Y finanzas.consultar (muestra
  // utilidad): el checklist solo ofrece el botón de un paso si el rol
  // de esta persona puede entrar a esa pantalla, nunca manda a un
  // "sin acceso".
  const puedeConectarMl = await puedeConsultarModulo(usuario.id, activa.id, "configuracion");
  let finanzas: Omit<React.ComponentProps<typeof InicioFinanzas>, "operacion"> | null = null;
  if (veFinanzas) {
    // Un solo reloj: el mismo «hoy» y el mismo mes en todas las lecturas.
    const ahora = new Date();
    const mesActual = tramosBogota(ahora).actual;
    const desdeParam = normalizarParametro(searchParams.desde);
    const hastaParam = normalizarParametro(searchParams.hasta);
    let periodoTramo = mesActual;
    let error: string | null = null;
    if (desdeParam || hastaParam) {
      const r = tramoDeFechas(desdeParam ?? (hastaParam as string), hastaParam ?? (desdeParam as string));
      if ("error" in r) error = r.error;
      else periodoTramo = r.tramo;
    }
    const esMesActual = periodoTramo.desdeTexto === mesActual.desdeTexto && periodoTramo.hastaTexto === mesActual.hastaTexto;

    const hoy = await leerIndicadores(activa.id, usuario.id, tramoDeHoy(ahora));
    const mes = await leerIndicadores(activa.id, usuario.id, mesActual);
    const periodo = esMesActual ? mes : await leerIndicadores(activa.id, usuario.id, periodoTramo);
    const meta = await leerMetaDelMes(activa.id, usuario.id, ahora, mes);
    const ok = normalizarParametro(searchParams.ok);
    const errorMeta = normalizarParametro(searchParams.error);
    finanzas = {
      hoy,
      periodo,
      mes,
      tablero: esMesActual ? await leerTableroMes(activa.id, usuario.id, ahora) : null,
      meta,
      // La meta la fija solo el Dueño (#126); la acción lo vuelve a pedir.
      puedeFijarMeta: rolNombre === "Dueño" && tienePermiso(permisos, "finanzas", "modificar"),
      filtro: { desde: periodoTramo.desdeTexto, hasta: periodoTramo.hastaTexto, esMesActual, error },
      avisoMeta: ok ? { tipo: "ok", texto: ok } : errorMeta ? { tipo: "error", texto: errorMeta } : null,
    };
  }

  const operacion = (
    <div className={styles.gridKpi}>
      {vePedidosYDespachos && kpis.despachosPendientes !== null && <TarjetaKpi titulo="Despachos pendientes" valor={kpis.despachosPendientes} />}
      {veSku && kpis.skuSinVincular !== null && <TarjetaKpi titulo="SKU sin vincular" valor={kpis.skuSinVincular} />}
    </div>
  );

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

      <ChecklistOnboarding empresaId={activa.id} puedeConectarMl={puedeConectarMl} puedeVerPedidos={vePedidosYDespachos && veFinanzas} />

      {finanzas ? (
        <InicioFinanzas {...finanzas} operacion={operacion} />
      ) : (
        <div className={styles.gridKpi}>
          {vePedidosYDespachos && kpis.ventasDeHoy !== null && (
            <TarjetaKpi titulo="Ventas de hoy" valor={kpis.ventasDeHoy.cantidad} detalle={detalleVentasDeHoy(kpis.ventasDeHoy)} />
          )}
          {vePedidosYDespachos && kpis.ventasDelMes !== null && (
            <TarjetaKpi titulo="Ventas del mes" valor={formatearVentasDelMes(kpis.ventasDelMes)} />
          )}
          {vePedidosYDespachos && kpis.despachosPendientes !== null && (
            <TarjetaKpi titulo="Despachos pendientes" valor={kpis.despachosPendientes} />
          )}
          {veSku && kpis.skuSinVincular !== null && <TarjetaKpi titulo="SKU sin vincular" valor={kpis.skuSinVincular} />}
        </div>
      )}

      <Link href="/crear-empresa" className={styles.crearEmpresa}>
        {iconoDeClave("crearEmpresa", { size: 16 })}
        + Crear otra empresa
      </Link>
    </>
  );
}
