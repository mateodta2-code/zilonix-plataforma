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
import { formatearMoneda, formatearNumero } from "@/lib/ml/sitios";
import { leerCuentaMlDeQuery } from "@/lib/ml/selector-cuenta";
import { descripcionPeriodo, leerPeriodoLista, MAXIMO_DIAS_RANGO, parametrosPeriodoLista } from "@/lib/optimizacion/periodoLista";
import { clasificarPareto, leerGrupo, ROTULO_GRUPO, type GrupoPareto } from "@/lib/optimizacion/rendimiento";
import { leerRendimientoBase, type DatosRendimientoBase } from "@/lib/optimizacion/rendimientoDatos";
import { OPCIONES_DIAS_METRICAS } from "@/lib/optimizacion/textos";
import { hoyBogota, restarDiasIso } from "@/lib/publicidad/plan";
import { requierePermiso, SinPermisoError } from "@/lib/permisos";
import { tienePermiso } from "@/lib/roles-plantillas";
import { obtenerOCrearUsuarioActual } from "@/lib/usuarios";
import { RendimientoConAccionables } from "./Accionables";
import type { FilaRendimiento } from "./TablaRendimiento";
import styles from "./rendimiento.module.css";

// Optimización · Rendimiento — «Qué hacer primero» (accionables por plata en
// juego) arriba de la tabla; Pareto de ingresos (Killer / Potencial /
// Cola larga), tráfico orgánico vs Ads y CTR/conversión comparados con la
// mediana de la cuenta por categoría. Sigue el período de la lista (?dias=,
// ?periodo=hoy, ?desde=&hasta=). Ver pide inventario.consultar; los montos,
// además ventas.consultar. Solo lectura.

type ParametroUrl = string | string[] | undefined;

function primero(valor: ParametroUrl): string | undefined {
  if (typeof valor === "string") return valor;
  if (Array.isArray(valor)) return valor.find((v) => typeof v === "string");
  return undefined;
}

function href(params: { cuenta: string | null; periodo: Record<string, string>; grupo?: GrupoPareto | null }): string {
  const q = new URLSearchParams();
  if (params.cuenta) q.set("cuenta", params.cuenta);
  for (const [clave, valor] of Object.entries(params.periodo)) q.set(clave, valor);
  if (params.grupo) q.set("grupo", params.grupo);
  const texto = q.toString();
  return texto ? `/panel/optimizacion/rendimiento?${texto}` : "/panel/optimizacion/rendimiento";
}

export default async function RendimientoPage({
  searchParams,
}: {
  searchParams?: { cuenta?: ParametroUrl; grupo?: ParametroUrl; dias?: ParametroUrl; periodo?: ParametroUrl; desde?: ParametroUrl; hasta?: ParametroUrl };
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
  const grupo = leerGrupo(primero(searchParams?.grupo));
  const ahora = new Date();
  const periodo = leerPeriodoLista(
    { dias: primero(searchParams?.dias), periodo: primero(searchParams?.periodo), desde: primero(searchParams?.desde), hasta: primero(searchParams?.hasta) },
    ahora
  );
  const periodoParams = parametrosPeriodoLista(periodo);
  const hoy = hoyBogota(ahora);
  const { cuentas, cuentaId } = await leerCuentaMlDeQuery(empresa.id, cuentaParam);
  const miMembresia = await obtenerMiMembresia(usuario.id, empresa.id);
  const verMontos = miMembresia ? tienePermiso(miMembresia.permisos, "ventas", "consultar") : false;

  const conectada = cuentaId ? (await listarCuentasConectadas(empresa.id)).find((c) => c.id === cuentaId && !c.desconectadaTs) : undefined;
  let base: DatosRendimientoBase | null = null;
  let aviso: string | null = null;
  if (conectada) {
    try {
      base = await leerRendimientoBase(empresa.id, conectada.id, periodo);
    } catch (error) {
      console.warn(`[app/panel/optimizacion/rendimiento] cuenta ${conectada.id}: ${error instanceof Error ? error.name : "error"}`);
      aviso = "No se pudieron leer las ventas de esta cuenta. Actualiza la página para reintentar.";
    }
  }

  const pareto = base ? clasificarPareto(base.filas) : null;
  // Sin ventas/consultar los montos no salen del servidor: solo los %.
  const filas: FilaRendimiento[] = pareto
    ? pareto.filas.map((f) => ({
        itemId: f.itemId,
        titulo: f.titulo,
        foto: f.foto,
        sku: f.sku,
        grupo: f.grupo,
        porcentaje: f.porcentaje,
        acumulado: f.acumulado,
        ingresos: verMontos ? f.ingresos : null,
        ventas: f.ventas,
        clics: f.clics,
        impresiones: f.impresiones,
      }))
    : [];

  return (
    <>
      <EncabezadoPagina
        titulo="Optimización"
        descripcion={`Qué publicaciones te generan los ingresos, cuánto de su tráfico viene de Ads y cómo convierten, ${descripcionPeriodo(periodo)}.`}
      />

      <Pestanas
        pestanas={[
          { etiqueta: "Publicaciones", href: `/panel/optimizacion${cuentaId ? `?cuenta=${cuentaId}` : ""}`, activa: false },
          { etiqueta: "Análisis", href: `/panel/optimizacion/analisis${cuentaId ? `?cuenta=${cuentaId}` : ""}`, activa: false },
          { etiqueta: "Rendimiento", href: `/panel/optimizacion/rendimiento${cuentaId ? `?cuenta=${cuentaId}` : ""}`, activa: true },
          { etiqueta: "Bitácora", href: `/panel/optimizacion/bitacora${cuentaId ? `?cuenta=${cuentaId}` : ""}`, activa: false },
        ]}
      />

      <div className={styles.panelDatos}>
        <SelectorCuentaMl empresaId={empresa.id} cuenta={cuentaParam} parametros={{ ...(grupo ? { grupo } : {}), ...periodoParams }} />
      </div>

      {cuentas.length === 0 ? (
        <EstadoVacio>
          No hay cuentas de Mercado Libre en esta empresa.{" "}
          <BotonLink href="/panel/conectar-ml">Conectar Mercado Libre</BotonLink>
        </EstadoVacio>
      ) : !cuentaId ? (
        <EstadoVacio>Elige una cuenta de Mercado Libre para ver su rendimiento.</EstadoVacio>
      ) : !conectada ? (
        <EstadoVacio>Esa cuenta está desconectada. Vuelve a conectarla en Conectar Mercado Libre.</EstadoVacio>
      ) : aviso ? (
        <div className={styles.aviso}>
          <p className={styles.avisoTitulo}>No se pudo armar el rendimiento:</p>
          <p className={styles.avisoTexto}>{aviso}</p>
        </div>
      ) : base && pareto ? (
        <>
          <div className={styles.grupos}>
            {(["killer", "potencial", "cola"] as const).map((g) => {
              const r = pareto.grupos[g];
              return (
                <Link key={g} scroll={false} className={styles.grupo} href={href({ cuenta: cuentaId, periodo: periodoParams, grupo: grupo === g ? null : g })} aria-current={grupo === g ? "true" : undefined}>
                  <h2 className={styles.grupoTitulo}>{ROTULO_GRUPO[g]}</h2>
                  <span className={styles.grupoValor}>{`${formatearNumero(r.cantidad, conectada.idioma)} ${r.cantidad === 1 ? "publicación" : "publicaciones"}`}</span>
                  <span className={styles.grupoNota}>
                    {`${formatearNumero(Math.round(r.porcentaje * 10) / 10, conectada.idioma)} % de los ingresos`}
                    {verMontos ? ` · ${formatearMoneda(r.ingresos, conectada.siteId)}` : ""}
                  </span>
                </Link>
              );
            })}
          </div>

          <Tarjeta className={styles.tarjeta}>
            <div className={styles.barra}>
              <span className={styles.filtro} role="group" aria-label="Período">
                <Link scroll={false} href={href({ cuenta: cuentaId, periodo: { periodo: "hoy" }, grupo })} aria-current={periodo.clave === "hoy" ? "page" : undefined}>
                  Hoy
                </Link>
                {OPCIONES_DIAS_METRICAS.map((opcion) => (
                  <Link
                    key={opcion}
                    scroll={false}
                    href={href({ cuenta: cuentaId, periodo: opcion === 7 ? {} : { dias: String(opcion) }, grupo })}
                    aria-current={periodo.clave === String(opcion) ? "page" : undefined}
                  >
                    {`${opcion} d`}
                  </Link>
                ))}
                <details className={styles.personalizado} open={periodo.clave === "rango"}>
                  <summary aria-current={periodo.clave === "rango" ? "page" : undefined}>{periodo.clave === "rango" ? `Personalizado · ${periodo.rotulo}` : "Personalizado"}</summary>
                  <form method="get" action="/panel/optimizacion/rendimiento" className={styles.rangoFechas}>
                    <input type="hidden" name="cuenta" value={cuentaId} />
                    {grupo ? <input type="hidden" name="grupo" value={grupo} /> : null}
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
              {grupo ? (
                <Link scroll={false} className={styles.nota} href={href({ cuenta: cuentaId, periodo: periodoParams })}>
                  {`Mostrando: ${ROTULO_GRUPO[grupo]} · ver todas`}
                </Link>
              ) : null}
            </div>
            <p className={styles.nota}>
              Semáforos comparados con la mediana de tu cuenta en la misma categoría.
              {" "}Los ingresos y las ventas salen de lo que Seller ya sincronizó; los clics de Ads, de Publicidad.
              {!base.tieneAds ? " Esta cuenta no tiene Product Ads sincronizados: las columnas de Ads dicen «Sin Ads»." : ""}
            </p>
            {base.canceladas > 0 ? (
              <p className={styles.nota}>{`${formatearNumero(base.canceladas, conectada.idioma)} ${base.canceladas === 1 ? "venta cancelada excluida" : "ventas canceladas excluidas"} de los ingresos.`}</p>
            ) : null}
            {filas.length === 0 ? (
              <EstadoVacio>No hay ventas ni Ads en este período.</EstadoVacio>
            ) : (
              <RendimientoConAccionables filas={filas} grupo={grupo} cuentaMlId={conectada.id} siteId={conectada.siteId} idioma={conectada.idioma} periodo={periodo} verMontos={verMontos} consultaPeriodo={new URLSearchParams(periodoParams).toString()} />
            )}
          </Tarjeta>
        </>
      ) : null}
    </>
  );
}
