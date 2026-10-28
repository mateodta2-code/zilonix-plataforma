import Link from "next/link";
import { obtenerContextoPanel } from "@/lib/panel-contexto";
import { acotarPagina, normalizarParametro, parsearPagina } from "@/lib/filtros-listado";
import { listarCuentasMlParaSelector, PARAM_CUENTA, resolverCuentaMl } from "@/lib/ml/selector-cuenta";
import { mostrarMonto } from "@/lib/finanzas/montos";
import type { TotalesDetalle } from "@/lib/finanzas/detalle-ventas";
import { listarVentasUtilidad, RangoVentasInvalidoError, type ResultadoVentasUtilidad } from "@/lib/finanzas/ventas-consulta";
import { porcentajeVentasConCosto, resolverRangoVentas } from "@/lib/finanzas/ventas-pantalla";
import { requierePermiso, SinPermisoError } from "@/lib/permisos";
import { Boton, BotonLink } from "@/components/marco/Boton";
import { Campo } from "@/components/marco/Campo";
import { Chip } from "@/components/marco/Chip";
import { CeldaTabla, FilaTabla, Tabla } from "@/components/marco/Tabla";
import { EncabezadoPagina } from "@/components/marco/EncabezadoPagina";
import { EstadoVacio } from "@/components/marco/EstadoVacio";
import { SinAcceso } from "@/components/marco/SinAcceso";
import { TarjetaKpi } from "@/components/marco/TarjetaKpi";
import { ETIQUETA_FORMA, mostrarPorcentaje } from "./formato";
import estilos from "./ventas.module.css";
import styles from "../finanzas.module.css";

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

type Filtros = { cuenta?: string; desde: string; hasta: string; costo?: "con" | "sin" };

function hrefCon(filtros: Filtros, pagina: number): string {
  const params = new URLSearchParams();
  if (filtros.cuenta) params.set(PARAM_CUENTA, filtros.cuenta);
  params.set("desde", filtros.desde);
  params.set("hasta", filtros.hasta);
  if (filtros.costo) params.set("costo", filtros.costo);
  if (pagina > 1) params.set("pagina", String(pagina));
  return `/panel/finanzas/ventas?${params.toString()}`;
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

// Issue #131 (Z-FIN-09, Parte A) — ventas y utilidad, SOLO LECTURA.
// Filtros por cuenta, rango de días de Bogotá (máximo 31, por defecto el
// mes en curso) y con/sin costo. Sin ícono de quitar, sin lápiz y sin
// botones de guardar o recalcular: la corrección manual es la Parte B y
// el recálculo con el costo actual, la Parte C.
export default async function VentasUtilidadPage({ searchParams }: { searchParams: Record<string, string | string[] | undefined> }) {
  const { usuario, activa: empresa, rolNombre } = await obtenerContextoPanel();

  try {
    await requierePermiso(usuario.id, empresa.id, "finanzas", "consultar");
  } catch (error) {
    if (!(error instanceof SinPermisoError)) throw error;
    return <SinAcceso mensaje={`Tu rol (${rolNombre}) no tiene acceso a Finanzas.`} />;
  }

  const cuentas = await listarCuentasMlParaSelector(empresa.id);
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
      datos = await listarVentasUtilidad(empresa.id, usuario.id, {
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
  const filtros: Filtros = { cuenta: cuentaId ?? undefined, desde: desdeForm, hasta: hastaForm, costo };

  const total = datos?.detalle.total;
  const dias = datos?.detalle.dias ?? [];
  const totalPaginas = Math.ceil(dias.length / DIAS_POR_PAGINA);
  const pagina = acotarPagina(parsearPagina(normalizarParametro(searchParams.pagina)), totalPaginas);
  const diasPagina = dias.slice((pagina - 1) * DIAS_POR_PAGINA, pagina * DIAS_POR_PAGINA);
  const conDevolucion = new Set(datos?.conDevolucion ?? []);

  return (
    <>
      <EncabezadoPagina
        titulo="Ventas y utilidad"
        descripcion="Utilidad por venta antes de publicidad: recaudo − comisión ML − flete ML − costo − packing − envío agencia. Solo lectura."
      />

      <form method="get" className={styles.filtros}>
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
        <div className={styles.accionesFiltro}>
          <Boton type="submit" chico>
            Filtrar
          </Boton>
          <BotonLink href="/panel/finanzas/ventas" variante="fantasma" chico>
            Mes actual
          </BotonLink>
        </div>
      </form>

      {errorRango && <p className={styles.avisoError}>{errorRango}</p>}

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
            <div className={styles.avisoError}>
              {datos.rechazadas.length} {datos.rechazadas.length === 1 ? "venta no se pudo calcular" : "ventas no se pudieron calcular"} y no entran en
              los totales:
              <ul className={estilos.listaSimple}>
                {datos.rechazadas.map((r) => (
                  <li key={r.pedidoId}>
                    <Link href={`/panel/finanzas/ventas/${r.pedidoId}`} className={styles.enlace}>
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
              <section className={styles.seccion}>
                <h2 className={styles.tituloSeccion}>Total por cuenta, antes de publicidad</h2>
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

              <section className={styles.seccion}>
                <h2 className={styles.tituloSeccion}>Detalle día a día · cuenta · producto</h2>
                <Tabla encabezados={COLUMNAS}>
                  {diasPagina.map((dia) => (
                    <DiaFilas key={dia.dia} dia={dia} datos={datos as ResultadoVentasUtilidad} conDevolucion={conDevolucion} />
                  ))}
                </Tabla>
                {totalPaginas > 1 && (
                  <div className={styles.paginacion}>
                    <span className={styles.suave}>
                      Página {pagina} de {totalPaginas} · {dias.length} días con ventas
                    </span>
                    <div className={styles.accionesFiltro}>
                      {pagina > 1 && (
                        <BotonLink href={hrefCon(filtros, pagina - 1)} variante="fantasma" chico>
                          Días más nuevos
                        </BotonLink>
                      )}
                      {pagina < totalPaginas && (
                        <BotonLink href={hrefCon(filtros, pagina + 1)} variante="fantasma" chico>
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

      <BotonLink href="/panel/finanzas" variante="fantasma" chico className={styles.volver}>
        Volver a Finanzas
      </BotonLink>
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
            <Link href={`/panel/finanzas/ventas/${p.pedido_id}`} className={styles.enlace}>
              {p.titulo}
            </Link>{" "}
            <span className={styles.suave}>[{p.sku_codigo ?? "sin SKU"}]</span>
            <div className={estilos.marcas}>
              <Chip>{ETIQUETA_FORMA[p.forma_entrega]}</Chip>
              {conDevolucion.has(p.pedido_id) && <Chip estado="peligro">con devolución · revisar</Chip>}
              <span className={styles.suave}>#{datos.pedidoIdExterno[p.pedido_id]}</span>
            </div>
          </CeldaTabla>
          <CeldasMontos t={p} costo={p.costo_producto} utilidad={p.utilidad} />
        </tr>
      ))}
    </>
  );
}
