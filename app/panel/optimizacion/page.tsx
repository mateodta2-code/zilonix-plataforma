import Link from "next/link";
import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { Boton, BotonLink } from "@/components/marco/Boton";
import { EncabezadoPagina } from "@/components/marco/EncabezadoPagina";
import { EstadoVacio } from "@/components/marco/EstadoVacio";
import { SinAcceso } from "@/components/marco/SinAcceso";
import { Tarjeta } from "@/components/marco/Tarjeta";
import { SelectorCuentaMl } from "@/components/SelectorCuentaMl";
import { listarEmpresasDeUsuario } from "@/lib/empresas";
import { obtenerMiMembresia } from "@/lib/membresias";
import { listarCuentasConectadas } from "@/lib/ml/cuentas";
import { motivoCuentaSinRevisar } from "@/lib/ml/preguntas";
import { leerCuentaMlDeQuery } from "@/lib/ml/selector-cuenta";
import { leerPaginaOptimizacion, MAXIMO_RESULTADOS_BUSQUEDA, type PaginaOptimizacion } from "@/lib/optimizacion/lista";
import { leerResumenTienda, type DatosResumenTienda } from "@/lib/optimizacion/resumenTiendaDatos";
import { publicacionesParaRevisar } from "@/lib/optimizacion/bitacora";
import { DIAS_METRICAS, leerBusqueda, leerDiasMetricas, leerFiltroEstado, leerPagina, OPCIONES_DIAS_METRICAS, type DiasMetricas, type FiltroEstado } from "@/lib/optimizacion/textos";
import { requierePermiso, SinPermisoError } from "@/lib/permisos";
import { tienePermiso } from "@/lib/roles-plantillas";
import { obtenerOCrearUsuarioActual } from "@/lib/usuarios";
import { ResumenTienda } from "./ResumenTienda";
import { TablaOptimizacion } from "./TablaOptimizacion";
import styles from "./page.module.css";

// Optimización, Fase 1 — lista de publicaciones de una cuenta, como las
// muestra Mercado Libre, más visitas, ventas y conversión de 7, 14, 30
// o 90 días (?dias=, 7 por defecto),
// calidad y competencia en el catálogo. Ver pide inventario/consultar
// (igual que Publicar e Investigación); pausar o activar,
// inventario/modificar.

type ParametroUrl = string | string[] | undefined;

function primero(valor: ParametroUrl): string | undefined {
  if (typeof valor === "string") return valor;
  if (Array.isArray(valor)) return valor.find((v) => typeof v === "string");
  return undefined;
}

const ROTULO_FILTRO: Record<FiltroEstado, string> = { activas: "Activas", pausadas: "Pausadas", todas: "Todas" };

function hrefOptimizacion(params: { cuenta: string | null; estado: FiltroEstado; q: string; pagina: number; dias: DiasMetricas }): string {
  const q = new URLSearchParams();
  if (params.cuenta) q.set("cuenta", params.cuenta);
  if (params.estado !== "activas") q.set("estado", params.estado);
  if (params.dias !== DIAS_METRICAS) q.set("dias", String(params.dias));
  if (params.q) q.set("q", params.q);
  if (params.pagina > 1) q.set("pagina", String(params.pagina));
  const texto = q.toString();
  return texto ? `/panel/optimizacion?${texto}` : "/panel/optimizacion";
}

export default async function OptimizacionPage({
  searchParams,
}: {
  searchParams?: { cuenta?: ParametroUrl; estado?: ParametroUrl; q?: ParametroUrl; pagina?: ParametroUrl; dias?: ParametroUrl };
}) {
  const usuario = await obtenerOCrearUsuarioActual();
  if (!usuario) redirect("/sign-in");

  const propias = await listarEmpresasDeUsuario(usuario.id);
  const empresaId = cookies().get("empresa_actual")?.value;
  const empresa = propias.find((e) => e.id === empresaId) ?? propias[0];
  if (!empresa) redirect("/crear-empresa");

  try {
    await requierePermiso(usuario.id, empresa.id, "inventario", "consultar");
  } catch (error) {
    if (!(error instanceof SinPermisoError)) throw error;
    const miMembresia = await obtenerMiMembresia(usuario.id, empresa.id);
    return (
      <>
        <EncabezadoPagina titulo="Optimización" />
        <SinAcceso mensaje={`Tu rol (${miMembresia?.rolNombre ?? "sin rol"}) no tiene acceso a este módulo.`} />
      </>
    );
  }

  const cuentaParam = primero(searchParams?.cuenta);
  const estado = leerFiltroEstado(primero(searchParams?.estado));
  const texto = leerBusqueda(primero(searchParams?.q));
  const pagina = leerPagina(primero(searchParams?.pagina));
  const dias = leerDiasMetricas(primero(searchParams?.dias));
  const { cuentas, cuentaId } = await leerCuentaMlDeQuery(empresa.id, cuentaParam);
  const miMembresia = await obtenerMiMembresia(usuario.id, empresa.id);
  const puedeModificar = miMembresia ? tienePermiso(miMembresia.permisos, "inventario", "modificar") : false;
  // Los montos del resumen de la tienda, con el mismo permiso que Pedidos.
  const verMontos = miMembresia ? tienePermiso(miMembresia.permisos, "ventas", "consultar") : false;

  const conectada = cuentaId ? (await listarCuentasConectadas(empresa.id)).find((c) => c.id === cuentaId && !c.desconectadaTs) : undefined;
  let datos: PaginaOptimizacion | null = null;
  let aviso: string | null = null;
  let resumen: DatosResumenTienda | null = null;
  let paraRevisar: string[] = [];
  if (conectada) {
    const ahora = new Date();
    // El resumen de la tienda nunca tumba la lista: si falla, no se muestra.
    const [lista, resumenLeido] = await Promise.all([
      leerPaginaOptimizacion(empresa.id, conectada, { estado, texto, pagina, dias }, ahora).then(
        (d) => ({ ok: true as const, datos: d }),
        (error: unknown) => ({ ok: false as const, error })
      ),
      leerResumenTienda(empresa.id, conectada, dias, ahora).catch((error: unknown) => {
        console.warn(`[app/panel/optimizacion] resumen ${conectada.id}: ${error instanceof Error ? error.name : "error"}`);
        return null;
      }),
    ]);
    resumen = resumenLeido;
    if (lista.ok) {
      datos = lista.datos;
      // Bitácora: publicaciones con un cambio que ya cumplió 7 días.
      paraRevisar = await publicacionesParaRevisar(
        empresa.id,
        lista.datos.filas.map((f) => f.id),
        ahora
      ).catch(() => []);
    } else {
      console.warn(`[app/panel/optimizacion] cuenta ${conectada.id}: ${lista.error instanceof Error ? lista.error.name : "error"}`);
      aviso = motivoCuentaSinRevisar(lista.error);
    }
  }
  const base = { cuenta: cuentaId, estado, q: texto, pagina: 1, dias };

  return (
    <>
      <EncabezadoPagina
        titulo="Optimización"
        descripcion={`Tus publicaciones como las muestra Mercado Libre, con visitas, ventas y conversión de los últimos ${dias} días, su calidad y cómo vas en la competencia del catálogo.`}
      />

      <div className={styles.panelDatos}>
        <SelectorCuentaMl empresaId={empresa.id} cuenta={cuentaParam} parametros={{ ...(estado !== "activas" ? { estado } : {}), ...(texto ? { q: texto } : {}), ...(dias !== DIAS_METRICAS ? { dias: String(dias) } : {}) }} />
      </div>

      {conectada && resumen && !aviso ? (
        <Tarjeta className={styles.tarjeta}>
          <ResumenTienda datos={resumen} dias={dias} siteId={conectada.siteId} idioma={conectada.idioma} verMontos={verMontos} />
        </Tarjeta>
      ) : null}

      {cuentas.length === 0 ? (
        <EstadoVacio>
          No hay cuentas de Mercado Libre en esta empresa.{" "}
          <BotonLink href="/panel/conectar-ml">
            Conectar Mercado Libre
          </BotonLink>
        </EstadoVacio>
      ) : !cuentaId ? (
        <EstadoVacio>Elige una cuenta de Mercado Libre para ver sus publicaciones.</EstadoVacio>
      ) : !conectada ? (
        <EstadoVacio>Esa cuenta está desconectada. Vuelve a conectarla en Conectar Mercado Libre.</EstadoVacio>
      ) : aviso ? (
        <div className={styles.aviso}>
          <p className={styles.avisoTitulo}>No se pudo revisar esta cuenta de Mercado Libre:</p>
          <p className={styles.avisoTexto}>{aviso}</p>
        </div>
      ) : datos ? (
        <Tarjeta className={styles.tarjeta}>
          <div className={styles.barra}>
            <form method="get" action="/panel/optimizacion" className={styles.buscador}>
              <input type="hidden" name="cuenta" value={cuentaId} />
              {estado !== "activas" ? <input type="hidden" name="estado" value={estado} /> : null}
              {dias !== DIAS_METRICAS ? <input type="hidden" name="dias" value={dias} /> : null}
              <input
                className="zx-control"
                type="search"
                name="q"
                defaultValue={texto}
                maxLength={100}
                placeholder="Buscar por título, SKU o código"
                aria-label="Buscar publicación"
              />
              <Boton type="submit">
                Buscar
              </Boton>
            </form>
            <span className={styles.filtro} role="group" aria-label="Período de visitas y ventas">
              {OPCIONES_DIAS_METRICAS.map((opcion) => (
                <Link key={opcion} scroll={false} href={hrefOptimizacion({ ...base, dias: opcion })} aria-current={dias === opcion ? "page" : undefined}>
                  {`${opcion} d`}
                </Link>
              ))}
            </span>
            <span className={styles.filtro}>
              {(Object.keys(ROTULO_FILTRO) as FiltroEstado[]).map((opcion) => (
                <Link key={opcion} scroll={false} href={hrefOptimizacion({ ...base, estado: opcion })} aria-current={estado === opcion ? "page" : undefined}>
                  {ROTULO_FILTRO[opcion]}
                </Link>
              ))}
            </span>
          </div>
          <p className={styles.nota}>
            {`${datos.total} ${datos.total === 1 ? "publicación" : "publicaciones"}.`}
            {datos.busquedaLocal
              ? ` · la búsqueda por título usa las publicaciones ya importadas en Seller (hasta ${MAXIMO_RESULTADOS_BUSQUEDA}).`
              : ""}
            {" "}Las ventas salen de las ventas que Seller ya sincronizó; la conversión es ventas ÷ visitas.
          </p>
          {datos.omitidas > 0 ? (
            <p className={styles.avisoError}>
              {`Mercado Libre no entregó el detalle de ${datos.omitidas} ${datos.omitidas === 1 ? "publicación" : "publicaciones"} de esta página. Actualiza para reintentar.`}
            </p>
          ) : null}
          {datos.filas.length === 0 ? (
            <EstadoVacio>{texto ? "Ninguna publicación coincide con la búsqueda." : "No hay publicaciones con este filtro."}</EstadoVacio>
          ) : (
            <TablaOptimizacion
              filas={datos.filas}
              cuentaMlId={conectada.id}
              siteId={conectada.siteId}
              idioma={conectada.idioma}
              puedeModificar={puedeModificar}
              dias={dias}
              paraRevisar={paraRevisar}
            />
          )}
          {datos.paginas > 1 ? (
            <nav className={styles.paginas} aria-label="Páginas">
              {datos.pagina > 1 ? (
                <Link scroll={false} href={hrefOptimizacion({ ...base, pagina: datos.pagina - 1 })}>
                  ← Anterior
                </Link>
              ) : (
                <span />
              )}
              <span className={styles.nota}>{`Página ${datos.pagina} de ${datos.paginas}`}</span>
              {datos.pagina < datos.paginas ? (
                <Link scroll={false} href={hrefOptimizacion({ ...base, pagina: datos.pagina + 1 })}>
                  Siguiente →
                </Link>
              ) : (
                <span />
              )}
            </nav>
          ) : null}
        </Tarjeta>
      ) : null}
    </>
  );
}
