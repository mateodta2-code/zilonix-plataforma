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
import { TarjetaKpi } from "@/components/marco/TarjetaKpi";
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
import { hrefPublicidad, leerParametrosPublicidad, opcionesDeMes } from "@/lib/publicidad/params";
import {
  AYUDA_DIAGNOSTICO,
  AYUDA_PRESUPUESTO,
  AYUDA_TACOS_TIENDA,
  NOTA_ATRIBUCION,
  NOTA_HOY_INCOMPLETO,
  NOTA_TACOS_TIENDA,
  ROTULO_COLUMNA_CAMPANA,
  ROTULO_PERIODO,
} from "@/lib/publicidad/rotulos";
import { obtenerOCrearUsuarioActual } from "@/lib/usuarios";
import { actualizarPublicidadAction } from "./actions";
import styles from "./page.module.css";
import { TablaCampanas } from "./TablaCampanas";
import { kpisDelResumen, pintarCampana } from "./vista";

// Issue #255 — tablero de solo lectura. La fase 1 ya dejaba el estado
// del anunciante y el botón "Actualizar ahora"; esta pantalla suma los
// KPIs y las campañas. Sigue exigiendo publicidad/consultar antes de leer.

type ParametroUrl = string | string[] | undefined;

function primero(valor: ParametroUrl): string | undefined {
  if (typeof valor === "string") return valor;
  if (Array.isArray(valor)) return valor.find((v) => typeof v === "string");
  return undefined;
}

const COLUMNAS: { clave: ColumnaOrden | "estado"; rotulo: string; fija?: boolean }[] = [
  { clave: "campana", rotulo: ROTULO_COLUMNA_CAMPANA.campana, fija: true },
  { clave: "estado", rotulo: ROTULO_COLUMNA_CAMPANA.estado },
  { clave: "inversion", rotulo: ROTULO_COLUMNA_CAMPANA.inversion },
  { clave: "ventas_publicidad", rotulo: ROTULO_COLUMNA_CAMPANA.ventasPublicidad },
  { clave: "ventas_totales", rotulo: ROTULO_COLUMNA_CAMPANA.ventasTotales },
  { clave: "roas", rotulo: ROTULO_COLUMNA_CAMPANA.roas },
  { clave: "acos", rotulo: ROTULO_COLUMNA_CAMPANA.acos },
  { clave: "tacos", rotulo: ROTULO_COLUMNA_CAMPANA.tacos },
  { clave: "cpc", rotulo: ROTULO_COLUMNA_CAMPANA.cpc },
  { clave: "clics", rotulo: ROTULO_COLUMNA_CAMPANA.clics },
  { clave: "impresiones", rotulo: ROTULO_COLUMNA_CAMPANA.impresiones },
  { clave: "presupuesto", rotulo: ROTULO_COLUMNA_CAMPANA.presupuesto },
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
    },
    ahora
  );
  const { cuentas, cuentaId } = await leerCuentaMlDeQuery(empresa.id, cuentaParam);
  const tablero = cuentaId
    ? await consultarTableroPublicidad(empresa.id, cuentaId, params.periodo, {
        incluirPausadas: params.incluirPausadas,
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
    pausadas: params.incluirPausadas,
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
              {params.incluirPausadas ? <input type="hidden" name="pausadas" value="1" /> : null}
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
              ...(params.incluirPausadas ? { pausadas: "1" } : {}),
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
            incluirPausadas={params.incluirPausadas}
            hrefBase={hrefBase}
            ahora={ahora}
          />
        )}
      </div>
    </>
  );
}

function Cuerpo({
  tablero,
  periodo,
  orden,
  dir,
  incluirPausadas,
  hrefBase,
  ahora,
}: {
  tablero: NonNullable<Awaited<ReturnType<typeof consultarTableroPublicidad>>>;
  periodo: ReturnType<typeof leerParametrosPublicidad>["periodo"];
  orden: ColumnaOrden;
  dir: DireccionOrden;
  incluirPausadas: boolean;
  hrefBase: {
    cuenta: string | null;
    mes: string;
    orden: ColumnaOrden;
    dir: DireccionOrden;
    pausadas: boolean;
  };
  ahora: Date;
}) {
  const sinPermiso = tablero.anunciante?.estadoAcceso === "sin_permiso_app";
  const sinProductAds = tablero.anunciante?.estadoAcceso === "sin_product_ads";
  const sinAnunciante = !tablero.anunciante;
  const primeraSync = tablero.enCurso && !tablero.ultimaOk && tablero.cantidadActivas + tablero.cantidadPausadas === 0;

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
  const kpis = kpisDelResumen(tablero);
  const campanas = tablero.campanas.map(pintarCampana);
  const sinMetricas = tablero.resumen.actual.gasto === null && tablero.resumen.actual.clicks === null;
  const actualizado = tablero.ultimaOk
    ? fechaHoraBogota(tablero.ultimaOk.terminadaTs ?? tablero.ultimaOk.iniciadaTs)
    : "—";

  const encabezados: EncabezadoTabla[] = COLUMNAS.map((columna) => {
    if (columna.clave === "estado") {
      return {
        clave: "estado",
        contenido: (
          <span className={styles.thConAyuda}>
            {columna.rotulo}
            <Ayuda id="ayuda-diagnostico">{AYUDA_DIAGNOSTICO}</Ayuda>
          </span>
        ),
      };
    }
    if (columna.clave === "presupuesto") {
      return {
        clave: "presupuesto",
        ariaSort: orden === "presupuesto" ? (dir === "asc" ? "ascending" : "descending") : "none",
        contenido: (
          <span className={styles.thConAyuda}>
            <LinkOrden hrefBase={hrefBase} columna="presupuesto" orden={orden} dir={dir} rotulo={columna.rotulo} />
            <Ayuda id="ayuda-presupuesto">{AYUDA_PRESUPUESTO}</Ayuda>
          </span>
        ),
      };
    }
    const activa = orden === columna.clave;
    return {
      clave: columna.clave,
      fija: columna.fija,
      ariaSort: activa ? (dir === "asc" ? "ascending" : "descending") : "none",
      contenido: <LinkOrden hrefBase={hrefBase} columna={columna.clave} orden={orden} dir={dir} rotulo={columna.rotulo} />,
    };
  });

  return (
    <>
      <div className={styles.panelDatos}>
        <form method="get" className={styles.barra}>
          {hrefBase.cuenta ? <input type="hidden" name="cuenta" value={hrefBase.cuenta} /> : null}
          <input type="hidden" name="orden" value={orden} />
          <input type="hidden" name="dir" value={dir} />
          {incluirPausadas ? <input type="hidden" name="pausadas" value="1" /> : null}
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
          <BotonLink
            href={hrefPublicidad({ ...hrefBase, pausadas: !incluirPausadas })}
            variante="fantasma"
            chico
          >
            {incluirPausadas ? ROTULO_PERIODO.ocultarPausadas : ROTULO_PERIODO.verPausadas}
          </BotonLink>
        </form>

        <p className={styles.nota}>
          Datos de Mercado Libre actualizados: {actualizado}. {textoComparacion(periodo)}
          {tablero.enCurso ? " Hay una actualización en curso." : ""}
        </p>
        <p className={styles.nota}>{NOTA_ATRIBUCION}</p>
        {periodo.incluyeHoy ? <p className={styles.nota}>{NOTA_HOY_INCOMPLETO}</p> : null}
        <p className={styles.nota}>
          {NOTA_TACOS_TIENDA} <Ayuda id="ayuda-tacos-tienda">{AYUDA_TACOS_TIENDA}</Ayuda>
        </p>
      </div>

      <div className={styles.gridKpi}>
        {kpis.map((kpi) => (
          <TarjetaKpi key={kpi.clave} titulo={kpi.titulo} valor={kpi.valor} detalle={kpi.detalle} variacion={kpi.variacion} textoVacio="—" />
        ))}
      </div>

      {campanas.length === 0 ? (
        <EstadoVacio>
          {incluirPausadas
            ? "Esta cuenta no tiene campañas de Product Ads."
            : "No hay campañas activas."}{" "}
          {!incluirPausadas && tablero.cantidadPausadas > 0 ? (
            <BotonLink href={hrefPublicidad({ ...hrefBase, pausadas: true })} chico>
              {ROTULO_PERIODO.verPausadas}
            </BotonLink>
          ) : null}
        </EstadoVacio>
      ) : (
        <Tarjeta className={styles.tarjetaTabla}>
          {sinMetricas ? <p className={styles.nota}>No hay métricas de Product Ads en este rango.</p> : null}
          <Tabla encabezados={encabezados} scroll>
            <TablaCampanas campanas={campanas} />
          </Tabla>
        </Tarjeta>
      )}
    </>
  );
}

function LinkOrden({
  hrefBase,
  columna,
  orden,
  dir,
  rotulo,
}: {
  hrefBase: {
    cuenta: string | null;
    mes: string;
    orden: ColumnaOrden;
    dir: DireccionOrden;
    pausadas: boolean;
  };
  columna: ColumnaOrden;
  orden: ColumnaOrden;
  dir: DireccionOrden;
  rotulo: string;
}) {
  const activa = orden === columna;
  const siguiente: DireccionOrden = activa ? (dir === "desc" ? "asc" : "desc") : columna === "campana" ? "asc" : "desc";
  return (
    <Link
      href={hrefPublicidad({ ...hrefBase, orden: columna, dir: siguiente })}
      className={activa ? `${styles.orden} ${styles.ordenActivo}` : styles.orden}
    >
      {rotulo}
      {activa ? (dir === "desc" ? " ↓" : " ↑") : ""}
    </Link>
  );
}
