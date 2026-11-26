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
import { leerCuentaMlDeQuery } from "@/lib/ml/selector-cuenta";
import { leerDatosAnalisis, MAXIMO_DIAS_ANALISIS, type DatosAnalisis } from "@/lib/optimizacion/analisisDatos";
import { leerPeriodoLista, MAXIMO_DIAS_RANGO, parametrosPeriodoLista } from "@/lib/optimizacion/periodoLista";
import { OPCIONES_DIAS_METRICAS } from "@/lib/optimizacion/textos";
import { hoyBogota, restarDiasIso } from "@/lib/publicidad/plan";
import { requierePermiso, SinPermisoError } from "@/lib/permisos";
import { tienePermiso } from "@/lib/roles-plantillas";
import { obtenerOCrearUsuarioActual } from "@/lib/usuarios";
import { AtribucionIngresos } from "./AtribucionIngresos";
import { CascadaIngresos } from "./CascadaIngresos";
import { TablaCambiosPublicacion } from "./TablaCambiosPublicacion";
import styles from "./analisis.module.css";

// Optimización · Análisis — por qué cambiaron los ingresos (visitas ×
// conversión × ticket, Shapley exacto) para el período de la lista contra
// los mismos días justo antes. Ver pide inventario/consultar; los montos,
// ventas/consultar (sin ese permiso solo porcentajes). Las visitas por
// publicación llegan después de pintar (TablaCambiosPublicacion).

type ParametroUrl = string | string[] | undefined;

function primero(valor: ParametroUrl): string | undefined {
  if (typeof valor === "string") return valor;
  if (Array.isArray(valor)) return valor.find((v) => typeof v === "string");
  return undefined;
}

function href(cuenta: string | null, periodo: Record<string, string>): string {
  const q = new URLSearchParams();
  if (cuenta) q.set("cuenta", cuenta);
  for (const [clave, valor] of Object.entries(periodo)) q.set(clave, valor);
  const texto = q.toString();
  return texto ? `/panel/optimizacion/analisis?${texto}` : "/panel/optimizacion/analisis";
}

export default async function AnalisisPage({
  searchParams,
}: {
  searchParams?: { cuenta?: ParametroUrl; dias?: ParametroUrl; periodo?: ParametroUrl; desde?: ParametroUrl; hasta?: ParametroUrl };
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
  const ahora = new Date();
  const entrada = { dias: primero(searchParams?.dias), periodo: primero(searchParams?.periodo), desde: primero(searchParams?.desde), hasta: primero(searchParams?.hasta) };
  const periodo = leerPeriodoLista(entrada, ahora);
  const periodoParams = parametrosPeriodoLista(periodo);
  const hoy = hoyBogota(ahora);
  const { cuentas, cuentaId } = await leerCuentaMlDeQuery(empresa.id, cuentaParam);
  const miMembresia = await obtenerMiMembresia(usuario.id, empresa.id);
  const verMontos = miMembresia ? tienePermiso(miMembresia.permisos, "ventas", "consultar") : false;

  const conectada = cuentaId ? (await listarCuentasConectadas(empresa.id)).find((c) => c.id === cuentaId && !c.desconectadaTs) : undefined;
  let datos: DatosAnalisis | null = null;
  let falla = false;
  if (conectada) {
    try {
      datos = await leerDatosAnalisis(empresa.id, conectada, periodo);
    } catch (error) {
      console.warn(`[app/panel/optimizacion/analisis] cuenta ${conectada.id}: ${error instanceof Error ? error.name : "error"}`);
      falla = true;
    }
  }
  const sufijo = cuentaId ? `?cuenta=${cuentaId}` : "";

  return (
    <>
      <EncabezadoPagina titulo="Optimización" descripcion="Por qué cambiaron tus ingresos: visitas, conversión o ticket, contra los mismos días justo antes." />

      <Pestanas
        pestanas={[
          { etiqueta: "Publicaciones", href: `/panel/optimizacion${sufijo}`, activa: false },
          { etiqueta: "Análisis", href: `/panel/optimizacion/analisis${sufijo}`, activa: true },
          { etiqueta: "Rendimiento", href: `/panel/optimizacion/rendimiento${sufijo}`, activa: false },
          { etiqueta: "Bitácora", href: `/panel/optimizacion/bitacora${sufijo}`, activa: false },
        ]}
      />

      <div className={styles.panelDatos}>
        <SelectorCuentaMl empresaId={empresa.id} cuenta={cuentaParam} parametros={periodoParams} />
      </div>

      {cuentas.length === 0 ? (
        <EstadoVacio>
          No hay cuentas de Mercado Libre en esta empresa.{" "}
          <BotonLink href="/panel/conectar-ml">Conectar Mercado Libre</BotonLink>
        </EstadoVacio>
      ) : !cuentaId ? (
        <EstadoVacio>Elige una cuenta de Mercado Libre para analizar sus ingresos.</EstadoVacio>
      ) : !conectada ? (
        <EstadoVacio>Esa cuenta está desconectada. Vuelve a conectarla en Conectar Mercado Libre.</EstadoVacio>
      ) : falla || !datos ? (
        <EstadoVacio>No se pudo leer el análisis de esta cuenta. Actualiza para reintentar.</EstadoVacio>
      ) : (
        <Tarjeta className={styles.tarjeta}>
          <div className={styles.barraPeriodo}>
            <span className={styles.filtro} role="group" aria-label="Período del análisis">
              <Link scroll={false} href={href(cuentaId, { periodo: "hoy" })} aria-current={periodo.clave === "hoy" ? "page" : undefined}>
                Hoy
              </Link>
              {OPCIONES_DIAS_METRICAS.map((opcion) => (
                <Link key={opcion} scroll={false} href={href(cuentaId, opcion === 7 ? {} : { dias: String(opcion) })} aria-current={periodo.clave === String(opcion) ? "page" : undefined}>
                  {`${opcion} d`}
                </Link>
              ))}
              <details className={styles.personalizado} open={periodo.clave === "rango"}>
                <summary aria-current={periodo.clave === "rango" ? "page" : undefined}>{periodo.clave === "rango" ? `Personalizado · ${periodo.rotulo}` : "Personalizado"}</summary>
                <form method="get" action="/panel/optimizacion/analisis" className={styles.rangoFechas}>
                  <input type="hidden" name="cuenta" value={cuentaId} />
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
            <span className={styles.nota}>
              {`Del ${datos.periodo.desde} al ${datos.periodo.hasta}, contra del ${datos.periodo.anteriorDesde} al ${datos.periodo.anteriorHasta}.`}
            </span>
          </div>

          {datos.periodo.recortado ? (
            <p className={styles.aviso}>
              {`Las visitas por publicación no alcanzan para más de ${MAXIMO_DIAS_ANALISIS} días: se recortó el análisis a los últimos ${MAXIMO_DIAS_ANALISIS} días del período.`}
            </p>
          ) : null}

          <AtribucionIngresos
            atribucion={datos.atribucion}
            muestraSuficiente={datos.muestraSuficiente}
            visitasDisponibles={datos.visitas.anterior !== null && datos.visitas.actual !== null}
            canceladas={datos.agrupado.canceladas}
            siteId={conectada.siteId}
            idioma={conectada.idioma}
            verMontos={verMontos}
          />

          {datos.atribucion && verMontos ? <CascadaIngresos atribucion={datos.atribucion} siteId={conectada.siteId} /> : null}

          <TablaCambiosPublicacion
            caidas={datos.caidas}
            crecimientos={datos.crecimientos}
            cuentaMlId={conectada.id}
            siteId={conectada.siteId}
            idioma={conectada.idioma}
            verMontos={verMontos}
            periodo={entrada}
          />
        </Tarjeta>
      )}
    </>
  );
}
