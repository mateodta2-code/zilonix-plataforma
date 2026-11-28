import Link from "next/link";
import { normalizarParametro } from "@/lib/filtros-listado";
import { listarCuentasMlParaSelector, PARAM_CUENTA, resolverCuentaMl } from "@/lib/ml/selector-cuenta";
import { mostrarMonto } from "@/lib/finanzas/montos";
import { listarVentasUtilidad, RangoVentasInvalidoError, type ResultadoVentasUtilidad } from "@/lib/finanzas/ventas-consulta";
import { normalizarBusqueda, porcentajeVentasConCosto, resolverRangoVentas, type FiltrosUrlVentas } from "@/lib/finanzas/ventas-pantalla";
import { requierePermiso, SinPermisoError } from "@/lib/permisos";
import { Boton, BotonLink } from "@/components/marco/Boton";
import { Campo } from "@/components/marco/Campo";
import { CeldaTabla, FilaTabla, Tabla, type EncabezadoTabla, type GrupoEncabezado } from "@/components/marco/Tabla";
import { EstadoVacio } from "@/components/marco/EstadoVacio";
import { Pestanas } from "@/components/marco/Pestanas";
import { TarjetaKpi } from "@/components/marco/TarjetaKpi";
import { BotonTraerVentasMes } from "./BotonTraerVentasMes";
import { CeldasMontos } from "./CeldasMontos";
import { TablaDetalleAcordeon } from "./TablaDetalleAcordeon";
import { TablaFueraDeUtilidad } from "./TablaFueraDeUtilidad";
import { AYUDA_COLUMNAS, mostrarPorcentaje } from "./formato";
import estilos from "./ventasUtilidad.module.css";

// Issue #131 (Parte A) — el «Detalle día a día · cuenta · producto» de
// Finanzas → Ventas, sacado a un componente para pintarlo igual en
// /panel/finanzas/ventas y en /panel/pedidos. Solo
// lectura: filtros, KPIs, total por cuenta y la tabla día → cuenta →
// producto. El permiso (finanzas.consultar) lo pide cada página antes de
// pintar esto, y listarVentasUtilidad lo vuelve a pedir y lee con RLS de
// la empresa: una empresa nunca ve ventas de otra. El botón «Traer
// ventas de este mes» solo sale con finanzas.modificar (escribe en
// pedidos_finanzas; la acción lo vuelve a pedir). Pedidos lo pinta con
// mostrarResumen={false}: sin tarjetas KPI ni «Total por cuenta» (esos
// indicadores van a Inicio, #143/#163); Finanzas → Ventas los sigue
// mostrando.
//
// Pestaña «Canceladas y devoluciones» (28-nov, solo Finanzas → Ventas,
// mostrarFueraDeUtilidad): las ventas que no suman a la utilidad, con
// los mismos filtros de cuenta, fechas y buscador (?vista=canceladas).
//
// La tabla día → cuenta → producto es un acordeón cliente
// (TablaDetalleAcordeon.tsx): acá se calcula todo y allá solo vive qué
// día y qué cuenta están abiertos.

// 27-nov (tabla más clara): nombres completos, el mismo en las dos tablas,
// y al pasar el mouse qué es cada número (AYUDA_COLUMNAS). Sin «Dev.»:
// siempre salía «—»; la devolución como concepto aparte vuelve con #164.
// Antes: Nº ventas, Dev., % util, % ML, Cnt.
const NOMBRES_COLUMNAS = ["Ventas", "Recaudo", "Comisión ML", "Flete ML", "Costo", "Packing", "Envío", "Utilidad", "Margen", "% comisión", "Unidades"];

function encabezado(nombre: string): EncabezadoTabla {
  return {
    clave: nombre,
    contenido: (
      <span className={estilos.encabezadoAyuda} title={AYUDA_COLUMNAS[nombre]}>
        {nombre}
      </span>
    ),
  };
}

const COLUMNAS_DETALLE: EncabezadoTabla[] = [{ clave: "nivel", contenido: "Día · cuenta · producto" }, ...NOMBRES_COLUMNAS.map(encabezado)];
// Fila de grupos encima de las columnas del detalle (el usuario pidió
// mantenerla con el estilo OS, 27-nov): se lee como la fórmula. Mismo
// orden que NOMBRES_COLUMNAS: 2 + 5 + 2 + 2 = 11.
const GRUPOS_DETALLE: GrupoEncabezado[] = [
  { clave: "nivel", etiqueta: "", columnas: 1, className: estilos.grupoVacio },
  { clave: "vendiste", etiqueta: "Lo que vendiste", columnas: 2, className: estilos.grupo },
  { clave: "descuenta", etiqueta: "Lo que se descuenta", columnas: 5, className: estilos.grupo },
  { clave: "ganaste", etiqueta: "Lo que ganaste", columnas: 2, className: `${estilos.grupo} ${estilos.grupoResultado}` },
  { clave: "datos", etiqueta: "Datos", columnas: 2, className: estilos.grupo },
];

const COLUMNAS_TOTAL_CUENTA: EncabezadoTabla[] = [{ clave: "cuenta", contenido: "Cuenta" }, ...NOMBRES_COLUMNAS.map(encabezado), encabezado("% con costo")];


type Props = {
  empresaId: string;
  usuarioId: string;
  searchParams: Record<string, string | string[] | undefined>;
  // Ruta de la página que lo pinta (el formulario y la paginación vuelven acá).
  ruta: string;
  // Parámetros fijos de esa ruta, si los tiene.
  extra?: Record<string, string>;
  // Tarjetas KPI y «Total por cuenta». false en Pedidos.
  mostrarResumen?: boolean;
  // Acciones extra en la franja de «Traer ventas» (Finanzas → Ventas:
  // recalcular costo, #131 Parte C). Pedidos no pasa nada.
  acciones?: React.ReactNode;
  // Issue #323 — Pedidos pasa un mensaje con el siguiente paso en
  // español neutro (onboarding de 5 minutos); sin esto, el texto por
  // defecto de abajo ("foto financiera") sigue para Finanzas → Ventas.
  mensajeVacio?: React.ReactNode;
  // Tope del rango de fechas. Finanzas → Ventas pasa 1 año; Pedidos
  // se queda con el de siempre (31 días).
  rangoMaximoDias?: number;
  // Pestañas «Ventas» / «Canceladas y devoluciones». Solo Finanzas → Ventas.
  mostrarFueraDeUtilidad?: boolean;
};

const VISTA_CANCELADAS = "canceladas";

export async function DetalleDiaCuentaProducto({
  empresaId,
  usuarioId,
  searchParams,
  ruta,
  extra = {},
  mostrarResumen = true,
  acciones,
  mensajeVacio,
  rangoMaximoDias,
  mostrarFueraDeUtilidad = false,
}: Props) {
  const cuentas = await listarCuentasMlParaSelector(empresaId);
  let puedeTraerVentas = true;
  try {
    await requierePermiso(usuarioId, empresaId, "finanzas", "modificar");
  } catch (error) {
    if (!(error instanceof SinPermisoError)) throw error;
    puedeTraerVentas = false;
  }
  // Solo un id de la lista de ESTA empresa llega al filtro; cualquier
  // otra cosa es "Todas".
  const cuentaId = resolverCuentaMl(searchParams[PARAM_CUENTA], cuentas);
  const costoParam = normalizarParametro(searchParams.costo);
  const costo = costoParam === "con" || costoParam === "sin" ? costoParam : undefined;
  const rango = resolverRangoVentas(normalizarParametro(searchParams.desde), normalizarParametro(searchParams.hasta), new Date(), rangoMaximoDias);
  // Buscador (27-nov): SKU, número de orden o nombre. Param «buscar» (no
  // «q»: Pedidos ya usa «q» para su propia lista).
  const buscarTexto = (normalizarParametro(searchParams.buscar) ?? "").slice(0, 120);
  const buscar = normalizarBusqueda(buscarTexto);
  const verCanceladas = mostrarFueraDeUtilidad && normalizarParametro(searchParams.vista) === VISTA_CANCELADAS;

  let datos: ResultadoVentasUtilidad | null = null;
  let errorRango = rango.error ?? null;
  if (rango.rango) {
    try {
      datos = await listarVentasUtilidad(empresaId, usuarioId, {
        cuentaId,
        desde: rango.rango.inicio,
        hastaExclusivo: rango.rango.finExclusivo,
        costo,
        buscar,
      });
    } catch (error) {
      if (!(error instanceof RangoVentasInvalidoError)) throw error;
      errorRango = error.message;
    }
  }

  const desdeForm = rango.rango?.desde ?? normalizarParametro(searchParams.desde) ?? "";
  const hastaForm = rango.rango?.hasta ?? normalizarParametro(searchParams.hasta) ?? "";
  const filtros: FiltrosUrlVentas = { cuenta: cuentaId ?? undefined, desde: desdeForm, hasta: hastaForm, costo, buscar: buscar ?? undefined };
  const hrefMesActual = Object.keys(extra).length > 0 ? `${ruta}?${new URLSearchParams(extra).toString()}` : ruta;
  // Cambiar de pestaña conserva los filtros.
  const hrefVista = (canceladas: boolean) => {
    const params = new URLSearchParams(extra);
    if (filtros.cuenta) params.set(PARAM_CUENTA, filtros.cuenta);
    if (filtros.desde) params.set("desde", filtros.desde);
    if (filtros.hasta) params.set("hasta", filtros.hasta);
    if (filtros.costo) params.set("costo", filtros.costo);
    if (buscarTexto) params.set("buscar", buscarTexto);
    if (canceladas) params.set("vista", VISTA_CANCELADAS);
    const query = params.toString();
    return query ? `${ruta}?${query}` : ruta;
  };

  const total = datos?.detalle.total;
  const dias = datos?.detalle.dias ?? [];
  // 27-nov: sin páginas de 7 días. Salen todos los días del rango en una
  // caja con barra para bajar (<Tabla scroll>, encabezado fijo); los días
  // arrancan cerrados salvo el más nuevo, así que el alto lo da el
  // número de días, no el de ventas.
  // Al acordeón (cliente) solo viajan los pedidos del rango.
  const idsRango = new Set(dias.flatMap((d) => d.cuentas.flatMap((c) => c.productos.map((p) => p.pedido_id))));
  const pedidoIdExternoRango = Object.fromEntries([...idsRango].map((id) => [id, datos?.pedidoIdExterno[id] ?? ""]));
  // Ventas cuya comisión no vino de Mercado Libre (ni marketplace_fee ni
  // sale_fee): suman $0 en la columna Comisión, y eso no puede pasar
  // callado (#131).
  const ventasSinComision = Object.values(datos?.avisosArmado ?? {}).filter((avisos) => avisos.includes("comision_sin_dato")).length;

  return (
    <>
      <form method="get" action={ruta} className={estilos.filtros}>
        {Object.entries(extra).map(([nombre, valor]) => (
          <input key={nombre} type="hidden" name={nombre} value={valor} />
        ))}
        {verCanceladas && <input type="hidden" name="vista" value={VISTA_CANCELADAS} />}
        <Campo etiqueta="Cuenta de Mercado Libre">
          <select name={PARAM_CUENTA} defaultValue={cuentaId ?? "todas"} className="zx-control">
            <option value="todas">Todas</option>
            {cuentas.map((c) => (
              <option key={c.id} value={c.id}>
                {c.apodo}
              </option>
            ))}
          </select>
        </Campo>
        <Campo etiqueta="Desde">
          <input type="date" name="desde" defaultValue={desdeForm} className="zx-control" />
        </Campo>
        <Campo etiqueta="Hasta">
          <input type="date" name="hasta" defaultValue={hastaForm} className="zx-control" />
        </Campo>
        <Campo etiqueta="Buscar SKU, orden o producto">
          <input type="search" name="buscar" defaultValue={buscarTexto} placeholder="Ej. FULCOL5737X2 o 2000019826695536" className="zx-control" />
        </Campo>
        <Campo etiqueta="Costo">
          <select name="costo" defaultValue={costo ?? ""} className="zx-control">
            <option value="">Con y sin costo</option>
            <option value="con">Solo con costo</option>
            <option value="sin">Solo sin costo</option>
          </select>
        </Campo>
        <div className={estilos.accionesFiltro}>
          <Boton type="submit">
            Filtrar
          </Boton>
          <BotonLink href={hrefMesActual} variante="fantasma">
            Mes actual
          </BotonLink>
        </div>
      </form>

      {puedeTraerVentas && <BotonTraerVentasMes cuentaId={cuentaId} />}
      {acciones}

      {errorRango && <p className={estilos.avisoError}>{errorRango}</p>}

      {datos && mostrarFueraDeUtilidad && (
        <Pestanas
          pestanas={[
            { etiqueta: `Ventas (${datos.detalle.total.ventas})`, href: hrefVista(false), activa: !verCanceladas },
            { etiqueta: `Canceladas y devoluciones (${datos.fueraDeUtilidad.length})`, href: hrefVista(true), activa: verCanceladas },
          ]}
        />
      )}

      {datos && verCanceladas && <TablaFueraDeUtilidad ventas={datos.fueraDeUtilidad} buscarTexto={buscarTexto} />}

      {datos && total && !verCanceladas && (
        <>
          {mostrarResumen && (
            <div className={estilos.gridKpi}>
              <TarjetaKpi titulo="Recaudo ventas" valor={mostrarMonto(total.recaudo)} detalle={[`${total.ventas} ventas · ${total.cantidad} unidades`]} />
              <TarjetaKpi titulo="Utilidad" valor={mostrarMonto(total.utilidad)} detalle={["Solo ventas con costo, antes de publicidad"]} />
              <TarjetaKpi titulo="Margen" valor={mostrarPorcentaje(total.porcentaje_utilidad)} detalle={["Utilidad ÷ recaudo de las ventas con costo"]} />
              <TarjetaKpi titulo="% comisión ML" valor={mostrarPorcentaje(total.porcentaje_ml)} detalle={["Comisión ÷ recaudo, sin flete"]} />
              <TarjetaKpi titulo="% de ventas con costo" valor={mostrarPorcentaje(porcentajeVentasConCosto(total))} />
              <TarjetaKpi
                titulo="Ventas sin costo"
                valor={`${total.ventas_sin_costo} ${total.ventas_sin_costo === 1 ? "venta" : "ventas"}`}
                detalle={[`${mostrarMonto(total.recaudo_sin_costo)} en recaudo`, ...(total.ventas_sin_costo > 0 ? ["Fuera de la utilidad hasta tener costo"] : [])]}
              />
            </div>
          )}

          {datos.rechazadas.length > 0 && (
            <div className={estilos.avisoError}>
              {datos.rechazadas.length} {datos.rechazadas.length === 1 ? "venta no se pudo calcular" : "ventas no se pudieron calcular"} y no entran en
              los totales:
              <ul className={estilos.listaSimple}>
                {datos.rechazadas.map((r) => (
                  <li key={r.pedidoId}>
                    <Link href={`/panel/finanzas/ventas/${r.pedidoId}`} className={estilos.enlace}>
                      #{r.pedidoIdExterno}
                    </Link>{" "}
                    — {r.motivo}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {total.ventas === 0 ? (
            <EstadoVacio>
              {buscar ? (
                <>No hay ventas que coincidan con «{buscarTexto}» en este rango. Revisa el SKU o el número de orden, o amplía las fechas.</>
              ) : mensajeVacio ?? (
                <>
                  No hay ventas con foto financiera en este rango.
                  {puedeTraerVentas && " Si las ventas de este mes no aparecen, usa «Traer ventas de este mes»."}
                </>
              )}
            </EstadoVacio>
          ) : (
            <>
              {mostrarResumen && (
                <section className={estilos.seccion}>
                  <h2 className={estilos.tituloSeccion}>Total por cuenta, antes de publicidad</h2>
                  <Tabla encabezados={COLUMNAS_TOTAL_CUENTA}>
                    {datos.resumenCuentas.map((c) => (
                      <FilaTabla key={c.cuenta_ml_id}>
                        <CeldaTabla>
                          <strong>{c.nickname}</strong>
                        </CeldaTabla>
                        <CeldasMontos t={c.totales} costo={c.totales.costo_producto} utilidad={c.totales.utilidad} />
                        <CeldaTabla className={estilos.numero}>{mostrarPorcentaje(c.porcentaje_ventas_con_costo)}</CeldaTabla>
                      </FilaTabla>
                    ))}
                  </Tabla>
                </section>
              )}

              <section className={estilos.seccion}>
                <h2 className={estilos.tituloSeccion}>Detalle día a día · cuenta · producto</h2>
                <p className={estilos.formula}>
                  <span>
                    <strong>Utilidad</strong> = Recaudo
                  </span>
                  <span>− Comisión ML − Flete ML − Costo − Packing − Envío</span>
                  <span className={estilos.formulaNota}>Antes de publicidad · pasa el mouse por cada columna para ver qué es</span>
                </p>
                {ventasSinComision > 0 && (
                  <p className={estilos.suave}>
                    Comisión sin dato de Mercado Libre en {ventasSinComision} {ventasSinComision === 1 ? "venta" : "ventas"}: cuenta como $0
                    {puedeTraerVentas ? ". Vuelve a traer las ventas para leerla del detalle de la orden." : "."}
                  </p>
                )}
                <div className={estilos.tablaCompacta}>
                  {/* La key cambia con los filtros: el acordeón vuelve a
                      abrir solo el día más nuevo del rango. */}
                  <TablaDetalleAcordeon
                    key={`${filtros.cuenta ?? ""}|${filtros.desde}|${filtros.hasta}|${filtros.costo ?? ""}|${filtros.buscar ?? ""}`}
                    encabezados={COLUMNAS_DETALLE}
                    grupos={GRUPOS_DETALLE}
                    dias={dias}
                    pedidoIdExterno={pedidoIdExternoRango}
                  />
                </div>
                <p className={estilos.suave}>
                  {dias.length} {dias.length === 1 ? "día" : "días"} con ventas en el rango
                </p>
              </section>
            </>
          )}
        </>
      )}
    </>
  );
}
