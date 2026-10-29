import Link from "next/link";
import { acotarPagina, normalizarParametro, parsearPagina } from "@/lib/filtros-listado";
import { listarCuentasMlParaSelector, PARAM_CUENTA, resolverCuentaMl } from "@/lib/ml/selector-cuenta";
import { mostrarMonto } from "@/lib/finanzas/montos";
import type { TotalesDetalle } from "@/lib/finanzas/detalle-ventas";
import { listarVentasUtilidad, RangoVentasInvalidoError, type ResultadoVentasUtilidad } from "@/lib/finanzas/ventas-consulta";
import { hrefVentasUtilidad, porcentajeVentasConCosto, resolverRangoVentas, type FiltrosUrlVentas } from "@/lib/finanzas/ventas-pantalla";
import { Boton, BotonLink } from "@/components/marco/Boton";
import { Campo } from "@/components/marco/Campo";
import { Chip } from "@/components/marco/Chip";
import { CeldaTabla, FilaTabla, Tabla } from "@/components/marco/Tabla";
import { EstadoVacio } from "@/components/marco/EstadoVacio";
import { TarjetaKpi } from "@/components/marco/TarjetaKpi";
import { ETIQUETA_FORMA, mostrarPorcentaje } from "./formato";
import estilos from "./ventasUtilidad.module.css";

// Issue #131 (Parte A) — el «Detalle día a día · cuenta · producto» de
// Finanzas → Ventas, sacado a un componente para pintarlo igual en
// /panel/finanzas/ventas y en /panel/pedidos?vista=detalle. Solo
// lectura: filtros, KPIs, total por cuenta y la tabla día → cuenta →
// producto. El permiso (finanzas.consultar) lo pide cada página antes de
// pintar esto, y listarVentasUtilidad lo vuelve a pedir y lee con RLS de
// la empresa: una empresa nunca ve ventas de otra.

// Días por página del detalle. Los totales de arriba son siempre de todo
// el rango.
const DIAS_POR_PAGINA = 7;

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

type Props = {
  empresaId: string;
  usuarioId: string;
  searchParams: Record<string, string | string[] | undefined>;
  // Ruta de la página que lo pinta (el formulario y la paginación vuelven acá).
  ruta: string;
  // Parámetros fijos de esa ruta, p. ej. { vista: "detalle" } en Pedidos.
  extra?: Record<string, string>;
};

export async function DetalleDiaCuentaProducto({ empresaId, usuarioId, searchParams, ruta, extra = {} }: Props) {
  const cuentas = await listarCuentasMlParaSelector(empresaId);
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

      {errorRango && <p className={estilos.avisoError}>{errorRango}</p>}

      {datos && total && (
        <>
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
            <EstadoVacio>No hay ventas con foto financiera en este rango.</EstadoVacio>
          ) : (
            <>
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

              <section className={estilos.seccion}>
                <h2 className={estilos.tituloSeccion}>Detalle día a día · cuenta · producto</h2>
                <Tabla encabezados={COLUMNAS}>
                  {diasPagina.map((dia) => (
                    <DiaFilas key={dia.dia} dia={dia} datos={datos as ResultadoVentasUtilidad} conDevolucion={conDevolucion} />
                  ))}
                </Tabla>
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
          {dia.dia} · {dia.numero_cuentas} {dia.numero_cuentas === 1 ? "cuenta" : "cuentas"} · {dia.numero_ventas}{" "}
          {dia.numero_ventas === 1 ? "venta" : "ventas"}
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
          {cuenta.nickname} · {cuenta.numero_ventas} Vta
        </CeldaTabla>
        <CeldasMontos t={cuenta.totales} costo={cuenta.totales.costo_producto} utilidad={cuenta.totales.utilidad} />
      </tr>
      {cuenta.productos.map((p) => (
        <tr key={`${p.pedido_id}-${p.linea}`} className={estilos.filaProducto}>
          <CeldaTabla className={estilos.sangriaProducto}>
            <Link href={`/panel/finanzas/ventas/${p.pedido_id}`} className={estilos.enlace}>
              {p.titulo}
            </Link>{" "}
            <span className={estilos.suave}>[{p.sku_codigo ?? "sin SKU"}]</span>
            <div className={estilos.marcas}>
              <Chip>{ETIQUETA_FORMA[p.forma_entrega]}</Chip>
              {conDevolucion.has(p.pedido_id) && <Chip estado="peligro">con devolución · revisar</Chip>}
              <span className={estilos.suave}>#{datos.pedidoIdExterno[p.pedido_id]}</span>
            </div>
          </CeldaTabla>
          <CeldasMontos t={p} costo={p.costo_producto} utilidad={p.utilidad} />
        </tr>
      ))}
    </>
  );
}
