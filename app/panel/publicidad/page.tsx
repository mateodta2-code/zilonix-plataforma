import Link from "next/link";
import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { Ayuda } from "@/components/marco/Ayuda";
import { Boton, BotonLink } from "@/components/marco/Boton";
import { EncabezadoPagina } from "@/components/marco/EncabezadoPagina";
import { EstadoVacio } from "@/components/marco/EstadoVacio";
import { SinAcceso } from "@/components/marco/SinAcceso";
import { Tabla, type EncabezadoTabla } from "@/components/marco/Tabla";
import { Tarjeta } from "@/components/marco/Tarjeta";
import { SelectorCuentaMl } from "@/components/SelectorCuentaMl";
import { fechaHoraBogota } from "@/components/finanzas/formato";
import { listarEmpresasDeUsuario } from "@/lib/empresas";
import { obtenerMiMembresia } from "@/lib/membresias";
import { SUGERENCIA_RECONECTAR_PUBLICIDAD } from "@/lib/ml/publicidad";
import { leerCuentaMlDeQuery } from "@/lib/ml/selector-cuenta";
import { requierePermiso, SinPermisoError } from "@/lib/permisos";
import { consultarTableroPublicidad } from "@/lib/publicidad/consultas";
import { textoComparacion } from "@/lib/publicidad/formato";
import type { ColumnaOrden, DireccionOrden } from "@/lib/publicidad/kpis";
import { hrefPublicidad, leerParametrosPublicidad, opcionesDeMes, type ComparacionPublicidad, type FiltroCampanas, type TabPublicidad } from "@/lib/publicidad/params";
import {
  AYUDA_DIAGNOSTICO,
  AYUDA_PRESUPUESTO,
  AYUDA_TACOS_TIENDA,
  NOTA_ATRIBUCION,
  NOTA_HOY_INCOMPLETO,
  NOTA_TACOS_TIENDA,
  ROTULO_COLUMNA_CAMPANA,
} from "@/lib/publicidad/rotulos";
import { obtenerOCrearUsuarioActual } from "@/lib/usuarios";
import { actualizarPublicidadAction } from "./actions";
import styles from "./page.module.css";
import { PanelMetricas } from "./GraficoPublicidad";
import { ResumenRecomendaciones, TablaAnuncios, TablaCampanas } from "./TablaCampanas";
import { kpisDelResumen, pintarCampana, plataVisible, serieParaGrafico, textoAporte } from "./vista";

// Issue #255 — tablero de solo lectura. La fase 1 ya dejaba el estado
// del anunciante y el botón "Actualizar ahora"; esta pantalla suma los
// KPIs y las campañas. Sigue exigiendo publicidad/consultar antes de leer.

type ParametroUrl = string | string[] | undefined;

function primero(valor: ParametroUrl): string | undefined {
  if (typeof valor === "string") return valor;
  if (Array.isArray(valor)) return valor.find((v) => typeof v === "string");
  return undefined;
}

const COLUMNAS: { clave: string; lineas: string[]; titulo?: string; fija?: boolean; orden?: ColumnaOrden }[] = [
  { clave: "campana", lineas: ["Campaña"], titulo: "Nombre de campaña", fija: true, orden: "campana" },
  { clave: "diagnostico", lineas: ["Diagnóstico"], titulo: "Diagnóstico" },
  { clave: "presupuesto", lineas: ["Presup.", "diario"], titulo: ROTULO_COLUMNA_CAMPANA.presupuesto, orden: "presupuesto" },
  { clave: "roas_objetivo", lineas: ["ROAS", "objetivo"], titulo: "ROAS objetivo" },
  { clave: "ventas_publicidad", lineas: ["Ventas", "atrib."], titulo: "Ventas atribuidas", orden: "ventas_publicidad" },
  { clave: "roas", lineas: [ROTULO_COLUMNA_CAMPANA.roas], titulo: "ROAS", orden: "roas" },
  { clave: "acos", lineas: [ROTULO_COLUMNA_CAMPANA.acos], titulo: "ACOS", orden: "acos" },
  { clave: "inversion", lineas: ["Inversión"], titulo: "Inversión", orden: "inversion" },
  { clave: "ingresos", lineas: ["Ingresos"], titulo: "Ingresos", orden: "ventas_totales" },
  { clave: "clics", lineas: [ROTULO_COLUMNA_CAMPANA.clics], titulo: "Clics", orden: "clics" },
  { clave: "impresiones", lineas: ["Impr."], titulo: ROTULO_COLUMNA_CAMPANA.impresiones, orden: "impresiones" },
];

export default async function PublicidadPage({
  searchParams,
}: {
  searchParams?: {
    cuenta?: ParametroUrl;
    aviso?: ParametroUrl;
    mes?: ParametroUrl;
    orden?: ParametroUrl;
    dir?: ParametroUrl;
    pausadas?: ParametroUrl;
    vista?: ParametroUrl;
    comparar?: ParametroUrl;
    tab?: ParametroUrl;
  };
}) {
  const usuario = await obtenerOCrearUsuarioActual();
  if (!usuario) redirect("/sign-in");

  const propias = await listarEmpresasDeUsuario(usuario.id);
  const empresaId = cookies().get("empresa_actual")?.value;
  const empresa = propias.find((e) => e.id === empresaId) ?? propias[0];
  if (!empresa) redirect("/crear-empresa");

  try {
    await requierePermiso(usuario.id, empresa.id, "publicidad", "consultar");
  } catch (error) {
    if (!(error instanceof SinPermisoError)) throw error;
    const miMembresia = await obtenerMiMembresia(usuario.id, empresa.id);
    return (
      <>
        <EncabezadoPagina titulo="Publicidad" />
        <SinAcceso mensaje={`Tu rol (${miMembresia?.rolNombre ?? "sin rol"}) no tiene acceso a este módulo.`} />
      </>
    );
  }

  const ahora = new Date();
  const cuentaParam = primero(searchParams?.cuenta);
  const aviso = primero(searchParams?.aviso);
  const params = leerParametrosPublicidad(
    {
      mes: primero(searchParams?.mes),
      orden: primero(searchParams?.orden),
      dir: primero(searchParams?.dir),
      pausadas: primero(searchParams?.pausadas),
      vista: primero(searchParams?.vista),
      comparar: primero(searchParams?.comparar),
      tab: primero(searchParams?.tab),
    },
    ahora
  );
  const { cuentas, cuentaId } = await leerCuentaMlDeQuery(empresa.id, cuentaParam);
  const tablero = cuentaId
    ? await consultarTableroPublicidad(empresa.id, cuentaId, params.periodo, {
        incluirPausadas: params.incluirPausadas,
        filtro: params.filtro,
        orden: params.orden,
        dir: params.dir,
        ahora,
      })
    : null;

  const hrefBase = {
    cuenta: cuentaId,
    mes: params.periodo.mes,
    orden: params.orden,
    dir: params.dir,
    vista: params.filtro,
    comparar: params.comparar,
    tab: params.tab,
  };

  return (
    <>
      <EncabezadoPagina
        titulo="Publicidad"
        descripcion="Product Ads de la cuenta, leídos de lo que ya está guardado. Esta pantalla no modifica campañas en Mercado Libre."
        accion={
          cuentaId ? (
            <form action={actualizarPublicidadAction}>
              <input type="hidden" name="cuentaMlId" value={cuentaId} />
              <input type="hidden" name="mes" value={params.periodo.mes} />
              <input type="hidden" name="orden" value={params.orden} />
              <input type="hidden" name="dir" value={params.dir} />
              {params.filtro !== "activas" ? <input type="hidden" name="vista" value={params.filtro} /> : null}
              {params.comparar === "ninguno" ? <input type="hidden" name="comparar" value="ninguno" /> : null}
              {params.tab === "anuncios" ? <input type="hidden" name="tab" value="anuncios" /> : null}
              <Boton type="submit">Actualizar ahora</Boton>
            </form>
          ) : null
        }
      />
      <div className={styles.bloque}>
        <div className={styles.panelDatos}>
          <SelectorCuentaMl
            empresaId={empresa.id}
            cuenta={cuentaParam}
            parametros={{
              mes: params.periodo.mes,
              orden: params.orden,
              dir: params.dir,
              ...(params.filtro !== "activas" ? { vista: params.filtro } : {}),
              ...(params.comparar === "ninguno" ? { comparar: "ninguno" } : {}),
              ...(params.tab === "anuncios" ? { tab: "anuncios" } : {}),
              ...(aviso ? { aviso } : {}),
            }}
          />
          {aviso ? <p className={styles.aviso}>{aviso}</p> : null}
        </div>
        {cuentas.length === 0 ? (
          <EstadoVacio>
            No hay cuentas de Mercado Libre en esta empresa.{" "}
            <BotonLink href="/panel/conectar-ml" chico>
              Conectar Mercado Libre
            </BotonLink>
          </EstadoVacio>
        ) : !cuentaId || !tablero ? (
          <EstadoVacio>Elegí una cuenta de Mercado Libre para ver su publicidad.</EstadoVacio>
        ) : (
          <Cuerpo
            tablero={tablero}
            periodo={params.periodo}
            orden={params.orden}
            dir={params.dir}
            filtro={params.filtro}
            comparar={params.comparar}
            tab={params.tab}
            hrefBase={hrefBase}
            ahora={ahora}
          />
        )}
      </div>
    </>
  );
}

type HrefBase = {
  cuenta: string | null;
  mes: string;
  orden: ColumnaOrden;
  dir: DireccionOrden;
  vista: FiltroCampanas;
  comparar: ComparacionPublicidad;
  tab: TabPublicidad;
};

function Cuerpo({
  tablero,
  periodo,
  orden,
  dir,
  filtro,
  comparar,
  tab,
  hrefBase,
  ahora,
}: {
  tablero: NonNullable<Awaited<ReturnType<typeof consultarTableroPublicidad>>>;
  periodo: ReturnType<typeof leerParametrosPublicidad>["periodo"];
  orden: ColumnaOrden;
  dir: DireccionOrden;
  filtro: FiltroCampanas;
  comparar: ComparacionPublicidad;
  tab: TabPublicidad;
  hrefBase: HrefBase;
  ahora: Date;
}) {
  const sinPermiso = tablero.anunciante?.estadoAcceso === "sin_permiso_app";
  const sinProductAds = tablero.anunciante?.estadoAcceso === "sin_product_ads";
  const sinAnunciante = !tablero.anunciante;
  const primeraSync =
    tablero.enCurso && !tablero.ultimaActualizacion && tablero.cantidadActivas + tablero.cantidadPausadas === 0;

  if (sinPermiso) {
    return <EstadoVacio>{SUGERENCIA_RECONECTAR_PUBLICIDAD}</EstadoVacio>;
  }
  if (sinProductAds) {
    return (
      <EstadoVacio>
        Esta cuenta no tiene Product Ads. Activalo en Mercado Libre &gt; Mi perfil &gt; Publicidad.
      </EstadoVacio>
    );
  }
  if (primeraSync || (sinAnunciante && tablero.enCurso)) {
    return <EstadoVacio>La primera sincronización está en curso. Los datos aparecen cuando termine.</EstadoVacio>;
  }
  if (sinAnunciante) {
    return <EstadoVacio>Todavía no hay una sincronización de esta cuenta. Usá Actualizar ahora.</EstadoVacio>;
  }

  const opciones = opcionesDeMes(ahora, periodo.mes);
  const siteId = tablero.anunciante?.siteId ?? "MCO";
  const kpis = kpisDelResumen(tablero, siteId);
  const campanas = tablero.campanas.map((campana) => pintarCampana(campana, tablero.diasRango, tablero.nombresCampanas));
  const sinMetricas = tablero.resumen.actual.gasto === null && tablero.resumen.actual.clicks === null;
  const momento = tablero.ultimaActualizacion?.terminadaTs ?? tablero.ultimaActualizacion?.iniciadaTs ?? null;
  const actualizado = momento ? fechaHoraBogota(momento) : "—";
  const totalCampanas = tablero.cantidadActivas + tablero.cantidadPausadas;
  const conComparacion = comparar === "anterior";

  const encabezados: EncabezadoTabla[] = COLUMNAS.map((columna) => {
    if (columna.clave === "diagnostico") {
      return {
        clave: "diagnostico",
        contenido: (
          <span className={styles.thConAyuda}>
            <RotuloLineas lineas={columna.lineas} titulo={columna.titulo} />
            <Ayuda id="ayuda-diagnostico">{AYUDA_DIAGNOSTICO}</Ayuda>
          </span>
        ),
      };
    }
    if (columna.orden === "presupuesto") {
      return {
        clave: "presupuesto",
        ariaSort: orden === "presupuesto" ? (dir === "asc" ? "ascending" : "descending") : "none",
        contenido: (
          <span className={styles.thConAyuda}>
            <LinkOrden hrefBase={hrefBase} columna="presupuesto" orden={orden} dir={dir} lineas={columna.lineas} titulo={columna.titulo} />
            <Ayuda id="ayuda-presupuesto">{AYUDA_PRESUPUESTO}</Ayuda>
          </span>
        ),
      };
    }
    if (!columna.orden) {
      return { clave: columna.clave, contenido: <RotuloLineas lineas={columna.lineas} titulo={columna.titulo} /> };
    }
    const activa = orden === columna.orden;
    return {
      clave: columna.clave,
      fija: columna.fija,
      ariaSort: activa ? (dir === "asc" ? "ascending" : "descending") : "none",
      contenido: (
        <LinkOrden hrefBase={hrefBase} columna={columna.orden} orden={orden} dir={dir} lineas={columna.lineas} titulo={columna.titulo} />
      ),
    };
  });

  const filtros: { valor: FiltroCampanas; rotulo: string }[] = [
    { valor: "activas", rotulo: "Activas" },
    { valor: "pausadas", rotulo: "Pausadas" },
    { valor: "todas", rotulo: "Todas" },
  ];

  return (
    <>
      <nav className={styles.pestanas} aria-label="Vistas de publicidad">
        <Link href={hrefPublicidad({ ...hrefBase, tab: "campanas" })} className={styles.pestana} aria-current={tab === "campanas" ? "page" : undefined}>
          Campañas
        </Link>
        <Link href={hrefPublicidad({ ...hrefBase, tab: "anuncios" })} className={styles.pestana} aria-current={tab === "anuncios" ? "page" : undefined}>
          Anuncios
        </Link>
      </nav>

      <p className={styles.nota}>
        Datos de Mercado Libre actualizados: {actualizado}. {textoComparacion(periodo)}
        {tablero.enCurso ? " Hay una actualización en curso." : ""}
      </p>

      <Tarjeta className={styles.miPresupuesto}>
        <p className={styles.seccion}>Mi presupuesto</p>
        <p className={styles.presupuestoEtiqueta}>Presupuesto promedio diario total</p>
        <p className={styles.presupuestoValor}>{plataVisible(tablero.presupuestoDiarioTotal, siteId)}</p>
        <p className={styles.nota}>Suma del presupuesto diario de las campañas activas. El presupuesto no se comparte entre campañas.</p>
      </Tarjeta>

      <section className={styles.panelDatos} aria-label="Métricas">
        <p className={styles.seccion}>Métricas</p>
        <form method="get" className={styles.barra}>
          {hrefBase.cuenta ? <input type="hidden" name="cuenta" value={hrefBase.cuenta} /> : null}
          <input type="hidden" name="orden" value={orden} />
          <input type="hidden" name="dir" value={dir} />
          {filtro !== "activas" ? <input type="hidden" name="vista" value={filtro} /> : null}
          {comparar === "ninguno" ? <input type="hidden" name="comparar" value="ninguno" /> : null}
          {tab === "anuncios" ? <input type="hidden" name="tab" value="anuncios" /> : null}
          <label className={styles.campo}>
            <span className="zx-etiqueta">Periodo</span>
            <select name="mes" className="zx-control" defaultValue={periodo.mes}>
              {opciones.map((opcion) => (
                <option key={opcion.valor} value={opcion.valor}>
                  {opcion.rotulo}
                </option>
              ))}
            </select>
          </label>
          <Boton type="submit" variante="secundario" chico>
            Ver
          </Boton>
          <div className={styles.campo}>
            <span className="zx-etiqueta">Comparado con</span>
            <span className={styles.filtro}>
              <Link href={hrefPublicidad({ ...hrefBase, comparar: "ninguno" })} aria-current={comparar === "ninguno" ? "page" : undefined}>
                Ninguno
              </Link>
              <Link href={hrefPublicidad({ ...hrefBase, comparar: "anterior" })} aria-current={comparar === "anterior" ? "page" : undefined}>
                Periodo anterior
              </Link>
            </span>
          </div>
        </form>
        <PanelMetricas kpis={kpis} serie={serieParaGrafico(tablero.serieDiaria)} aporte={textoAporte(tablero)} comparar={conComparacion} />
        <p className={styles.nota}>{NOTA_ATRIBUCION}</p>
        {periodo.incluyeHoy ? <p className={styles.nota}>{NOTA_HOY_INCOMPLETO}</p> : null}
        <p className={styles.nota}>
          {NOTA_TACOS_TIENDA} <Ayuda id="ayuda-tacos-tienda">{AYUDA_TACOS_TIENDA}</Ayuda>
        </p>
      </section>

      <Tarjeta className={tab === "campanas" ? styles.tarjetaTabla : styles.tarjetaAnuncios}>
        <div className={styles.toolbar}>
          <span className={styles.filtro}>
            <span className="zx-etiqueta">Filtrar</span>
            {filtros.map((opcion) => (
              <Link
                key={opcion.valor}
                href={hrefPublicidad({ ...hrefBase, vista: opcion.valor })}
                aria-current={filtro === opcion.valor ? "page" : undefined}
              >
                {opcion.rotulo}
              </Link>
            ))}
          </span>
          <span className={styles.nota}>
            {tab === "campanas"
              ? `${campanas.length} de ${totalCampanas} campañas`
              : `${campanas.reduce((n, campana) => n + campana.cantidadAnuncios, 0)} anuncios`}
          </span>
        </div>
        {sinMetricas ? <p className={styles.nota}>No hay métricas de Product Ads en este rango.</p> : null}
        {tab === "campanas" && campanas.length > 0 ? <ResumenRecomendaciones campanas={campanas} /> : null}
        {tab === "anuncios" ? (
          <TablaAnuncios campanas={campanas} />
        ) : campanas.length === 0 ? (
          <EstadoVacio>
            {filtro === "pausadas"
              ? "No hay campañas pausadas."
              : filtro === "todas"
                ? "Esta cuenta no tiene campañas de Product Ads."
                : "No hay campañas activas."}
          </EstadoVacio>
        ) : (
          <Tabla encabezados={encabezados} scroll>
            <TablaCampanas campanas={campanas} comparar={conComparacion} />
          </Tabla>
        )}
      </Tarjeta>
    </>
  );
}

function RotuloLineas({ lineas, titulo }: { lineas: string[]; titulo?: string }) {
  return (
    <span className={styles.rotuloColumna} title={titulo} aria-label={titulo}>
      {lineas.map((linea) => (
        <span key={linea}>{linea}</span>
      ))}
    </span>
  );
}

function LinkOrden({
  hrefBase,
  columna,
  orden,
  dir,
  lineas,
  titulo,
}: {
  hrefBase: HrefBase;
  columna: ColumnaOrden;
  orden: ColumnaOrden;
  dir: DireccionOrden;
  lineas: string[];
  titulo?: string;
}) {
  const activa = orden === columna;
  const siguiente: DireccionOrden = activa ? (dir === "desc" ? "asc" : "desc") : columna === "campana" ? "asc" : "desc";
  return (
    <Link
      href={hrefPublicidad({ ...hrefBase, orden: columna, dir: siguiente })}
      className={activa ? `${styles.orden} ${styles.ordenActivo}` : styles.orden}
      title={titulo}
      aria-label={titulo}
    >
      <RotuloLineas lineas={lineas} />
      {activa ? <span className={styles.flechaOrden}>{dir === "desc" ? "↓" : "↑"}</span> : null}
    </Link>
  );
}
