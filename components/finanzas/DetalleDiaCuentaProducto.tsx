import Link from "next/link";
import { acotarPagina, normalizarParametro, parsearPagina } from "@/lib/filtros-listado";
import { listarCuentasMlParaSelector, PARAM_CUENTA, resolverCuentaMl } from "@/lib/ml/selector-cuenta";
import { mostrarMonto } from "@/lib/finanzas/montos";
import type { TotalesDetalle } from "@/lib/finanzas/detalle-ventas";
import { listarVentasUtilidad, RangoVentasInvalidoError, type ResultadoVentasUtilidad } from "@/lib/finanzas/ventas-consulta";
import { hrefVentasUtilidad, porcentajeVentasConCosto, resolverRangoVentas, type FiltrosUrlVentas } from "@/lib/finanzas/ventas-pantalla";
import { requierePermiso, SinPermisoError } from "@/lib/permisos";
import { Boton, BotonLink } from "@/components/marco/Boton";
import { Campo } from "@/components/marco/Campo";
import { Chip } from "@/components/marco/Chip";
import { CeldaTabla, FilaTabla, Tabla } from "@/components/marco/Tabla";
import { EstadoVacio } from "@/components/marco/EstadoVacio";
import { TarjetaKpi } from "@/components/marco/TarjetaKpi";
import { BotonTraerVentasMes } from "./BotonTraerVentasMes";
import { ETIQUETA_FORMA, mostrarPorcentaje } from "./formato";
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

// Días por página del detalle. Los totales de arriba son siempre de todo
// el rango.
const DIAS_POR_PAGINA = 7;

// Encabezados largos: tabla «Total por cuenta» de Finanzas → Ventas.
const COLUMNAS = [
  "Día · cuenta · producto",
  "Número de ventas",
  "Recaudo ventas",
  "Comisión ML",
  "Flete ML",
  "Costo producto",
  "Packing",
  "Envío agencia",
  "Devolución",
  "Utilidad",
  "% util",
  "% ML",
  "Cnt",
];

// La tabla del detalle es compacta (estilo DETALLE DÍA A DÍA de Zilonix
// OS) y usa encabezados cortos con el mismo significado:
// Nº ventas = Número de ventas · Recaudo = Recaudo ventas · Comisión =
// Comisión ML · Flete = Flete ML · Costo = Costo producto · Envío =
// Envío agencia · Dev. = Devolución. El resto queda igual.
const COLUMNAS_CORTAS = [
  "Día · cuenta · producto",
  "Nº ventas",
  "Recaudo",
  "Comisión",
  "Flete",
  "Costo",
  "Packing",
  "Envío",
  "Dev.",
  "Utilidad",
  "% util",
  "% ML",
  "Cnt",
];

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
};

export async function DetalleDiaCuentaProducto({ empresaId, usuarioId, searchParams, ruta, extra = {}, mostrarResumen = true }: Props) {
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
  const rango = resolverRangoVentas(normalizarParametro(searchParams.desde), normalizarParametro(searchParams.hasta), new Date());

  let datos: ResultadoVentasUtilidad | null = null;
  let errorRango = rango.error ?? null;
  if (rango.rango) {
    try {
      datos = await listarVentasUtilidad(empresaId, usuarioId, {
        cuentaId,
        desde: rango.rango.inicio,
        hastaExclusivo: rango.rango.finExclusivo,
        costo,
      });
    } catch (error) {
      if (!(error instanceof RangoVentasInvalidoError)) throw error;
      errorRango = error.message;
    }
  }

  const desdeForm = rango.rango?.desde ?? normalizarParametro(searchParams.desde) ?? "";
  const hastaForm = rango.rango?.hasta ?? normalizarParametro(searchParams.hasta) ?? "";
  const filtros: FiltrosUrlVentas = { cuenta: cuentaId ?? undefined, desde: desdeForm, hasta: hastaForm, costo };
  const hrefMesActual = Object.keys(extra).length > 0 ? `${ruta}?${new URLSearchParams(extra).toString()}` : ruta;

  const total = datos?.detalle.total;
  const dias = datos?.detalle.dias ?? [];
  const totalPaginas = Math.ceil(dias.length / DIAS_POR_PAGINA);
  const pagina = acotarPagina(parsearPagina(normalizarParametro(searchParams.pagina)), totalPaginas);
  const diasPagina = dias.slice((pagina - 1) * DIAS_POR_PAGINA, pagina * DIAS_POR_PAGINA);
  const conDevolucion = new Set(datos?.conDevolucion ?? []);

  return (
    <>
      <form method="get" action={ruta} className={estilos.filtros}>
        {Object.entries(extra).map(([nombre, valor]) => (
          <input key={nombre} type="hidden" name={nombre} value={valor} />
        ))}
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
        <Campo etiqueta="Costo">
          <select name="costo" defaultValue={costo ?? ""} className="zx-control">
            <option value="">Con y sin costo</option>
            <option value="con">Solo con costo</option>
            <option value="sin">Solo sin costo</option>
          </select>
        </Campo>
        <div className={estilos.accionesFiltro}>
          <Boton type="submit" chico>
            Filtrar
          </Boton>
          <BotonLink href={hrefMesActual} variante="fantasma" chico>
            Mes actual
          </BotonLink>
        </div>
      </form>

      {puedeTraerVentas && <BotonTraerVentasMes cuentaId={cuentaId} />}

      {errorRango && <p className={estilos.avisoError}>{errorRango}</p>}

      {datos && total && (
        <>
          {mostrarResumen && (
            <div className={estilos.gridKpi}>
              <TarjetaKpi titulo="Recaudo ventas" valor={mostrarMonto(total.recaudo)} detalle={[`${total.ventas} ventas · ${total.cantidad} unidades`]} />
              <TarjetaKpi titulo="Utilidad" valor={mostrarMonto(total.utilidad)} detalle={["Solo ventas con costo, antes de publicidad"]} />
              <TarjetaKpi titulo="% util" valor={mostrarPorcentaje(total.porcentaje_utilidad)} />
              <TarjetaKpi titulo="% ML" valor={mostrarPorcentaje(total.porcentaje_ml)} detalle={["Comisión ÷ recaudo, sin flete"]} />
              <TarjetaKpi titulo="% de ventas con costo" valor={mostrarPorcentaje(porcentajeVentasConCosto(total))} />
              <TarjetaKpi
                titulo="Ventas sin costo"
                valor={`${total.ventas_sin_costo} ventas sin costo · ${mostrarMonto(total.recaudo_sin_costo)}`}
                detalle={total.ventas_sin_costo > 0 ? ["Fuera de la utilidad hasta tener costo"] : undefined}
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
              No hay ventas con foto financiera en este rango.
              {puedeTraerVentas && " Si las ventas de este mes no aparecen, usa «Traer ventas de este mes»."}
            </EstadoVacio>
          ) : (
            <>
              {mostrarResumen && (
                <section className={estilos.seccion}>
                  <h2 className={estilos.tituloSeccion}>Total por cuenta, antes de publicidad</h2>
                  <Tabla encabezados={["Cuenta", ...COLUMNAS.slice(1), "% con costo"]}>
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
                <div className={estilos.tablaCompacta}>
                  <Tabla encabezados={COLUMNAS_CORTAS}>
                    {diasPagina.map((dia) => (
                      <DiaFilas key={dia.dia} dia={dia} datos={datos as ResultadoVentasUtilidad} conDevolucion={conDevolucion} />
                    ))}
                  </Tabla>
                </div>
                {totalPaginas > 1 && (
                  <div className={estilos.paginacion}>
                    <span className={estilos.suave}>
                      Página {pagina} de {totalPaginas} · {dias.length} días con ventas
                    </span>
                    <div className={estilos.accionesFiltro}>
                      {pagina > 1 && (
                        <BotonLink href={hrefVentasUtilidad(ruta, extra, filtros, pagina - 1)} variante="fantasma" chico>
                          Días más nuevos
                        </BotonLink>
                      )}
                      {pagina < totalPaginas && (
                        <BotonLink href={hrefVentasUtilidad(ruta, extra, filtros, pagina + 1)} variante="fantasma" chico>
                          Días más viejos
                        </BotonLink>
                      )}
                    </div>
                  </div>
                )}
              </section>
            </>
          )}
        </>
      )}
    </>
  );
}

// Las columnas de dinero de una fila. Costo y utilidad null = venta sin
// costo: "—" y el chip, nunca un $0 inventado.
function CeldasMontos({ t, costo, utilidad }: { t: Omit<TotalesDetalle, "costo_producto" | "utilidad">; costo: string | null; utilidad: string | null }) {
  return (
    <>
      <CeldaTabla className={estilos.numero}>{t.ventas}</CeldaTabla>
      <CeldaTabla className={estilos.numero}>{mostrarMonto(t.recaudo)}</CeldaTabla>
      <CeldaTabla className={estilos.numero}>{mostrarMonto(t.comision_ml)}</CeldaTabla>
      <CeldaTabla className={estilos.numero}>{mostrarMonto(t.flete_ml)}</CeldaTabla>
      <CeldaTabla className={estilos.numero}>{costo === null ? <Chip estado="aviso">sin costo</Chip> : mostrarMonto(costo)}</CeldaTabla>
      <CeldaTabla className={estilos.numero}>{mostrarMonto(t.empaque)}</CeldaTabla>
      <CeldaTabla className={estilos.numero}>{mostrarMonto(t.envio)}</CeldaTabla>
      {/* La devolución como concepto aparte llega con #164. */}
      <CeldaTabla className={estilos.numero}>—</CeldaTabla>
      <CeldaTabla className={estilos.numero}>{utilidad === null ? "—" : mostrarMonto(utilidad)}</CeldaTabla>
      <CeldaTabla className={estilos.numero}>{utilidad === null ? "—" : mostrarPorcentaje(t.porcentaje_utilidad)}</CeldaTabla>
      <CeldaTabla className={estilos.numero}>{mostrarPorcentaje(t.porcentaje_ml)}</CeldaTabla>
      <CeldaTabla className={estilos.numero}>{t.cantidad}</CeldaTabla>
    </>
  );
}

function DiaFilas({
  dia,
  datos,
  conDevolucion,
}: {
  dia: ResultadoVentasUtilidad["detalle"]["dias"][number];
  datos: ResultadoVentasUtilidad;
  conDevolucion: Set<string>;
}) {
  return (
    <>
      <tr className={estilos.filaDia}>
        <CeldaTabla>
          {/* Corto, para que la 1ª columna no estire la tabla: «2 cta · 12 vtas». */}
          <span
            className={estilos.textoNivel}
            title={`${dia.dia} · ${dia.numero_cuentas} ${dia.numero_cuentas === 1 ? "cuenta" : "cuentas"} · ${dia.numero_ventas} ${dia.numero_ventas === 1 ? "venta" : "ventas"}`}
          >
            {dia.dia} · {dia.numero_cuentas} cta · {dia.numero_ventas} {dia.numero_ventas === 1 ? "vta" : "vtas"}
          </span>
        </CeldaTabla>
        <CeldasMontos t={dia.totales} costo={dia.totales.costo_producto} utilidad={dia.totales.utilidad} />
      </tr>
      {dia.cuentas.map((cuenta) => (
        <CuentaFilas key={cuenta.cuenta_ml_id} cuenta={cuenta} datos={datos} conDevolucion={conDevolucion} />
      ))}
    </>
  );
}

function CuentaFilas({
  cuenta,
  datos,
  conDevolucion,
}: {
  cuenta: ResultadoVentasUtilidad["detalle"]["dias"][number]["cuentas"][number];
  datos: ResultadoVentasUtilidad;
  conDevolucion: Set<string>;
}) {
  return (
    <>
      <tr className={estilos.filaCuenta}>
        <CeldaTabla className={estilos.sangriaCuenta}>
          <span className={estilos.textoNivel} title={`${cuenta.nickname} · ${cuenta.numero_ventas} Vta`}>
            {cuenta.nickname} · {cuenta.numero_ventas} Vta
          </span>
        </CeldaTabla>
        <CeldasMontos t={cuenta.totales} costo={cuenta.totales.costo_producto} utilidad={cuenta.totales.utilidad} />
      </tr>
      {cuenta.productos.map((p) => (
        <tr key={`${p.pedido_id}-${p.linea}`} className={estilos.filaProducto}>
          <CeldaTabla className={estilos.sangriaProducto}>
            {/* Una sola línea de ancho fijo: el título se corta con «…»,
                los chips van enseguida y SKU y número de pedido se cortan
                al final si no caben. Todo se lee entero al pasar el mouse. */}
            <div
              className={estilos.lineaProducto}
              title={`${p.titulo} · ${p.sku_codigo ?? "sin SKU"} · ${ETIQUETA_FORMA[p.forma_entrega]} · #${datos.pedidoIdExterno[p.pedido_id]}`}
            >
              <Link href={`/panel/finanzas/ventas/${p.pedido_id}`} className={`${estilos.enlace} ${estilos.tituloProducto}`}>
                {p.titulo}
              </Link>
              <Chip>{ETIQUETA_FORMA[p.forma_entrega]}</Chip>
              {conDevolucion.has(p.pedido_id) && (
                <Chip estado="peligro" title="Con devolución: revisar">
                  devolución
                </Chip>
              )}
              <span className={estilos.suave}>[{p.sku_codigo ?? "sin SKU"}]</span>
              <span className={estilos.suave}>#{datos.pedidoIdExterno[p.pedido_id]}</span>
            </div>
          </CeldaTabla>
          <CeldasMontos t={p} costo={p.costo_producto} utilidad={p.utilidad} />
        </tr>
      ))}
    </>
  );
}
