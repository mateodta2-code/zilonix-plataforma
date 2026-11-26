import Link from "next/link";
import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { Boton, BotonLink } from "@/components/marco/Boton";
import { EncabezadoPagina } from "@/components/marco/EncabezadoPagina";
import { EstadoVacio } from "@/components/marco/EstadoVacio";
import { Pestanas } from "@/components/marco/Pestanas";
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
import { sufijoPestanas } from "@/lib/optimizacion/pestanas";
import { descripcionPeriodo, leerPeriodoLista, MAXIMO_DIAS_RANGO, parametrosPeriodoLista } from "@/lib/optimizacion/periodoLista";
import { leerBusqueda, leerFiltroEstado, leerPagina, OPCIONES_DIAS_METRICAS, type FiltroEstado } from "@/lib/optimizacion/textos";
import { hoyBogota, restarDiasIso } from "@/lib/publicidad/plan";
import { requierePermiso, SinPermisoError } from "@/lib/permisos";
import { tienePermiso } from "@/lib/roles-plantillas";
import { obtenerOCrearUsuarioActual } from "@/lib/usuarios";
import { leerFiltroAlerta, tituloAlerta } from "@/lib/optimizacion/alertas";
import { AlertasPublicaciones } from "./AlertasPublicaciones";
import { DetalleAlerta } from "./DetalleAlerta";
import { ResumenTienda } from "./ResumenTienda";
import { TablaOptimizacion } from "./TablaOptimizacion";
import styles from "./page.module.css";

// Optimización, Fase 1 — lista de publicaciones de una cuenta, como las
// muestra Mercado Libre, más visitas, ventas y conversión de hoy
// (?periodo=hoy), 7, 14, 30 o 90 días (?dias=, 7 por defecto) o un rango
// (?desde=&hasta=, validado en lib/optimizacion/periodoLista.ts),
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

// `periodo`: los parámetros de URL del período (parametrosPeriodoLista).
function hrefOptimizacion(params: { cuenta: string | null; estado: FiltroEstado; q: string; pagina: number; periodo: Record<string, string> }): string {
  const q = new URLSearchParams();
  if (params.cuenta) q.set("cuenta", params.cuenta);
  if (params.estado !== "activas") q.set("estado", params.estado);
  for (const [clave, valor] of Object.entries(params.periodo)) q.set(clave, valor);
  if (params.q) q.set("q", params.q);
  if (params.pagina > 1) q.set("pagina", String(params.pagina));
  const texto = q.toString();
  return texto ? `/panel/optimizacion?${texto}` : "/panel/optimizacion";
}

export default async function OptimizacionPage({
  searchParams,
}: {
  searchParams?: { cuenta?: ParametroUrl; estado?: ParametroUrl; q?: ParametroUrl; pagina?: ParametroUrl; dias?: ParametroUrl; periodo?: ParametroUrl; desde?: ParametroUrl; hasta?: ParametroUrl; alerta?: ParametroUrl };
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
  const alerta = leerFiltroAlerta(primero(searchParams?.alerta));
  const ahora = new Date();
  const periodo = leerPeriodoLista(
    { dias: primero(searchParams?.dias), periodo: primero(searchParams?.periodo), desde: primero(searchParams?.desde), hasta: primero(searchParams?.hasta) },
    ahora
  );
  const periodoParams = parametrosPeriodoLista(periodo);
  const hoy = hoyBogota(ahora);
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
    // El resumen de la tienda nunca tumba la lista: si falla, no se muestra.
    const [lista, resumenLeido] = await Promise.all([
      leerPaginaOptimizacion(empresa.id, conectada, { estado, texto, pagina, periodo, alerta }, ahora).then(
        (d) => ({ ok: true as const, datos: d }),
        (error: unknown) => ({ ok: false as const, error })
      ),
      leerResumenTienda(empresa.id, conectada, periodo).catch((error: unknown) => {
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
  const base = { cuenta: cuentaId, estado, q: texto, pagina: 1, periodo: periodoParams };
  // Con una alerta se ignoran estado y búsqueda; el período se conserva.
  const hrefSinAlerta = hrefOptimizacion({ ...base, estado: "activas", q: "" });
  const hrefPagina = (n: number) => {
    if (!alerta) return hrefOptimizacion({ ...base, pagina: n });
    const q = new URLSearchParams();
    if (cuentaId) q.set("cuenta", cuentaId);
    for (const [k, v] of Object.entries(periodoParams)) q.set(k, v);
    q.set("alerta", alerta);
    if (n > 1) q.set("pagina", String(n));
    return `/panel/optimizacion?${q.toString()}`;
  };

  return (
    <>
      <EncabezadoPagina
        titulo="Optimización"
        descripcion={`Tus publicaciones como las muestra Mercado Libre, con visitas, ventas y conversión ${descripcionPeriodo(periodo)}, su calidad y cómo vas en la competencia del catálogo.`}
      />

      <Pestanas
        pestanas={[
          { etiqueta: "Publicaciones", href: `/panel/optimizacion${cuentaId ? `?cuenta=${cuentaId}` : ""}`, activa: true },
          { etiqueta: "Análisis", href: `/panel/optimizacion/analisis${sufijoPestanas(cuentaId, periodoParams)}`, activa: false },
          { etiqueta: "Rendimiento", href: `/panel/optimizacion/rendimiento${sufijoPestanas(cuentaId, periodoParams)}`, activa: false },
          { etiqueta: "Bitácora", href: `/panel/optimizacion/bitacora${cuentaId ? `?cuenta=${cuentaId}` : ""}`, activa: false },
        ]}
      />

      <div className={styles.panelDatos}>
        <SelectorCuentaMl empresaId={empresa.id} cuenta={cuentaParam} parametros={{ ...(estado !== "activas" ? { estado } : {}), ...(texto ? { q: texto } : {}), ...periodoParams }} />
      </div>

      {conectada && !aviso ? <AlertasPublicaciones cuentaMlId={conectada.id} idioma={conectada.idioma} activa={alerta} periodo={periodoParams} /> : null}

      {conectada && resumen && !aviso ? (
        <Tarjeta className={styles.tarjeta}>
          <ResumenTienda datos={resumen} periodo={periodo} siteId={conectada.siteId} idioma={conectada.idioma} verMontos={verMontos} />
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
              {Object.entries(periodoParams).map(([nombre, valor]) => (
                <input key={nombre} type="hidden" name={nombre} value={valor} />
              ))}
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
              <Link scroll={false} href={hrefOptimizacion({ ...base, periodo: { periodo: "hoy" } })} aria-current={periodo.clave === "hoy" ? "page" : undefined}>
                Hoy
              </Link>
              {OPCIONES_DIAS_METRICAS.map((opcion) => (
                <Link
                  key={opcion}
                  scroll={false}
                  href={hrefOptimizacion({ ...base, periodo: opcion === 7 ? {} : { dias: String(opcion) } })}
                  aria-current={periodo.clave === String(opcion) ? "page" : undefined}
                >
                  {`${opcion} d`}
                </Link>
              ))}
              {/* Sin JS: <details> abre el formulario GET con las dos fechas. */}
              <details className={styles.personalizado} open={periodo.clave === "rango"}>
                <summary aria-current={periodo.clave === "rango" ? "page" : undefined}>{periodo.clave === "rango" ? `Personalizado · ${periodo.rotulo}` : "Personalizado"}</summary>
                <form method="get" action="/panel/optimizacion" className={styles.rangoFechas}>
                  <input type="hidden" name="cuenta" value={cuentaId} />
                  {estado !== "activas" ? <input type="hidden" name="estado" value={estado} /> : null}
                  {texto ? <input type="hidden" name="q" value={texto} /> : null}
                  <label>
                    Desde
                    <input className="zx-control" type="date" name="desde" required defaultValue={periodo.clave === "rango" ? periodo.desde : undefined} min={restarDiasIso(hoy, MAXIMO_DIAS_RANGO - 1)} max={hoy} />
                  </label>
                  <label>
                    Hasta
                    <input className="zx-control" type="date" name="hasta" required defaultValue={periodo.clave === "rango" ? periodo.hasta : undefined} min={restarDiasIso(hoy, MAXIMO_DIAS_RANGO - 1)} max={hoy} />
                  </label>
                  <Boton type="submit">Aplicar</Boton>
                </form>
              </details>
            </span>
            <span className={styles.filtro}>
              {(Object.keys(ROTULO_FILTRO) as FiltroEstado[]).map((opcion) => (
                <Link key={opcion} scroll={false} href={hrefOptimizacion({ ...base, estado: opcion })} aria-current={estado === opcion ? "page" : undefined}>
                  {ROTULO_FILTRO[opcion]}
                </Link>
              ))}
            </span>
          </div>
          {alerta ? (
            <p className={styles.nota}>
              {`Mostrando: ${tituloAlerta(alerta)} · `}
              <Link scroll={false} href={hrefSinAlerta}>
                Quitar filtro
              </Link>
            </p>
          ) : null}
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
          {datos.alerta ? (
            <DetalleAlerta
              clave={datos.alerta.clave}
              cuentaMlId={conectada.id}
              siteId={conectada.siteId}
              idioma={conectada.idioma}
              filas={datos.filas.map((f) => ({ id: f.id, titulo: f.titulo }))}
              referencias={datos.alerta.referencias}
              estados={datos.alerta.estados}
              pendientes={datos.alerta.pendientes}
            />
          ) : null}
          {datos.filas.length === 0 ? (
            <EstadoVacio>{alerta ? "Ninguna publicación entra en esta alerta." : texto ? "Ninguna publicación coincide con la búsqueda." : "No hay publicaciones con este filtro."}</EstadoVacio>
          ) : (
            <TablaOptimizacion
              filas={datos.filas}
              cuentaMlId={conectada.id}
              siteId={conectada.siteId}
              idioma={conectada.idioma}
              puedeModificar={puedeModificar}
              periodo={periodo}
              paraRevisar={paraRevisar}
              periodoParams={periodoParams}
            />
          )}
          {datos.paginas > 1 ? (
            <nav className={styles.paginas} aria-label="Páginas">
              {datos.pagina > 1 ? (
                <Link scroll={false} href={hrefPagina(datos.pagina - 1)}>
                  ← Anterior
                </Link>
              ) : (
                <span />
              )}
              <span className={styles.nota}>{`Página ${datos.pagina} de ${datos.paginas}`}</span>
              {datos.pagina < datos.paginas ? (
                <Link scroll={false} href={hrefPagina(datos.pagina + 1)}>
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
