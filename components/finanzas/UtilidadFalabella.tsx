import { acotarPagina, normalizarParametro, parsearPagina } from "@/lib/filtros-listado";
import { listarCuentasFalabellaParaSelector, listarUtilidadFalabella } from "@/lib/finanzas/utilidad-falabella-consulta";
import type { EstadoUtilidadFalabella, OrdenUtilidadFalabella } from "@/lib/finanzas/utilidad-falabella";
import { resolverRangoVentas } from "@/lib/finanzas/ventas-pantalla";
import { Boton, BotonLink } from "@/components/marco/Boton";
import { Campo } from "@/components/marco/Campo";
import { Chip, type EstadoChip } from "@/components/marco/Chip";
import { EstadoVacio } from "@/components/marco/EstadoVacio";
import { CeldaTabla, FilaTabla, Tabla } from "@/components/marco/Tabla";
import { TarjetaKpi } from "@/components/marco/TarjetaKpi";
import { DefectosCuentaFalabella } from "./DefectosCuentaFalabella";
import { fechaHoraBogota, mostrarMontoIso, mostrarPorcentaje } from "./formato";
import { LapizMontoFalabella } from "./LapizMontoFalabella";
import estilos from "./ventasUtilidad.module.css";
import { SkuCopiable } from "@/components/marco/SkuCopiable";

// Issue #422 — utilidad por orden de Falabella, con el mismo formulario,
// tarjetas KPI y tabla que la de Mercado Libre (DetalleDiaCuentaProducto).
// El cálculo es lib/finanzas/utilidad-falabella.ts (puro) y la lectura,
// con RLS y finanzas.consultar, lib/finanzas/utilidad-falabella-consulta.ts.
// Los montos se pintan con la divisa de la cuenta (mostrarMontoIso),
// nunca con una fija.

export const PARAM_CUENTA_FALABELLA = "cuentaFalabella";
const ORDENES_POR_PAGINA = 50;

const ETIQUETA_ESTADO: Record<EstadoUtilidadFalabella, { texto: string; chip: EstadoChip }> = {
  calculada: { texto: "Calculada", chip: "exito" },
  estimada: { texto: "Estimada", chip: "aviso" },
  falta_costo: { texto: "Falta costo", chip: "advertencia" },
  sin_reporte: { texto: "Sin reporte de Falabella", chip: "aviso" },
  conflicto: { texto: "Nº de orden repetido", chip: "peligro" },
};

const FILTROS_ESTADO = ["estimada", "falta_costo", "sin_reporte", "conflicto"] as const;

// Columna «Producto»: el primero y «+ N más» si hay otros; el detalle
// completo (con cantidades) va en el title.
function CeldaProducto({ productos }: { productos: OrdenUtilidadFalabella["productos"] }) {
  if (productos.length === 0) return <span className={estilos.suave}>—</span>;
  const [primero, ...resto] = productos;
  const detalle = productos.map((p) => `${p.cantidad} × ${p.nombre}${p.sku ? ` (${p.sku})` : ""}`).join(" · ");
  return (
    <div className={estilos.productoFalabella} title={detalle}>
      <span className={estilos.nombreProductoFalabella}>
        {primero.nombre}
        {resto.length > 0 && <span className={estilos.suave}> + {resto.length} más</span>}
      </span>
      {primero.sku && <span className={estilos.datoProducto}><SkuCopiable sku={primero.sku} /></span>}
    </div>
  );
}

type Props = {
  empresaId: string;
  usuarioId: string;
  searchParams: Record<string, string | string[] | undefined>;
  ruta: string;
  // Parámetros fijos de la ruta (el marketplace elegido).
  extra?: Record<string, string>;
  // finanzas.modificar: muestra los lápices de Costo / Envío neto y los
  // valores por defecto de cada cuenta. Las acciones lo vuelven a pedir.
  puedeModificar?: boolean;
};

export async function UtilidadFalabella({ empresaId, usuarioId, searchParams, ruta, extra = {}, puedeModificar = false }: Props) {
  const cuentas = await listarCuentasFalabellaParaSelector(empresaId);
  // Solo un id de la lista de ESTA empresa llega al filtro.
  const cuentaParam = normalizarParametro(searchParams[PARAM_CUENTA_FALABELLA]);
  const cuentaId = cuentas.find((c) => c.id === cuentaParam)?.id ?? null;
  const estadoParam = normalizarParametro(searchParams.estado);
  const estado = FILTROS_ESTADO.find((e) => e === estadoParam);
  const rango = resolverRangoVentas(normalizarParametro(searchParams.desde), normalizarParametro(searchParams.hasta), new Date());

  const desdeForm = rango.rango?.desde ?? normalizarParametro(searchParams.desde) ?? "";
  const hastaForm = rango.rango?.hasta ?? normalizarParametro(searchParams.hasta) ?? "";
  const href = (cambios: Record<string, string | undefined>) => {
    const params = new URLSearchParams(extra);
    const base: Record<string, string | undefined> = {
      [PARAM_CUENTA_FALABELLA]: cuentaId ?? undefined,
      desde: desdeForm,
      hasta: hastaForm,
      estado,
      ...cambios,
    };
    for (const [k, v] of Object.entries(base)) if (v) params.set(k, v);
    return `${ruta}?${params.toString()}`;
  };

  const formulario = (
    <form method="get" action={ruta} className={estilos.filtros}>
      {Object.entries(extra).map(([nombre, valor]) => (
        <input key={nombre} type="hidden" name={nombre} value={valor} />
      ))}
      <Campo etiqueta="Cuenta de Falabella">
        <select name={PARAM_CUENTA_FALABELLA} defaultValue={cuentaId ?? ""} className="zx-control">
          <option value="">Todas</option>
          {cuentas.map((c) => (
            <option key={c.id} value={c.id}>
              {c.nickname}
              {c.desconectada ? " (desconectada)" : ""}
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
      <Campo etiqueta="Órdenes">
        <select name="estado" defaultValue={estado ?? ""} className="zx-control">
          <option value="">Todas</option>
          <option value="estimada">Solo «Estimada»</option>
          <option value="falta_costo">Solo con «Falta costo»</option>
          <option value="sin_reporte">Solo «Sin reporte de Falabella»</option>
          <option value="conflicto">Solo «Nº de orden repetido»</option>
        </select>
      </Campo>
      <div className={estilos.accionesFiltro}>
        <Boton type="submit">
          Filtrar
        </Boton>
        <BotonLink href={`${ruta}${Object.keys(extra).length > 0 ? `?${new URLSearchParams(extra).toString()}` : ""}`} variante="fantasma" chico>
          Mes actual
        </BotonLink>
      </div>
    </form>
  );

  if (cuentas.length === 0) {
    return (
      <>
        {formulario}
        <EstadoVacio>Todavía no tienes una cuenta de Falabella conectada.</EstadoVacio>
      </>
    );
  }
  if (!rango.rango) {
    return (
      <>
        {formulario}
        <p className={estilos.avisoError}>{rango.error}</p>
      </>
    );
  }

  const consulta = await listarUtilidadFalabella(empresaId, usuarioId, {
    cuentaId,
    desde: rango.rango.desde,
    hasta: rango.rango.hasta,
    inicio: rango.rango.inicio,
    finExclusivo: rango.rango.finExclusivo,
  });
  if (!consulta.ok) {
    return (
      <>
        {formulario}
        <p className={estilos.avisoError}>{consulta.error}</p>
      </>
    );
  }

  const { resultado, moneda, recortado } = consulta;
  const t = resultado.totales;
  const m = (valor: string | null) => (valor === null || !moneda ? "—" : mostrarMontoIso(valor, moneda));
  const ordenesFiltradas = estado ? resultado.ordenes.filter((o) => o.estado === estado) : resultado.ordenes;
  const totalPaginas = Math.ceil(ordenesFiltradas.length / ORDENES_POR_PAGINA);
  const pagina = acotarPagina(parsearPagina(normalizarParametro(searchParams.pagina)), totalPaginas);
  const ordenesPagina = ordenesFiltradas.slice((pagina - 1) * ORDENES_POR_PAGINA, pagina * ORDENES_POR_PAGINA);
  const skusSinCosto = [...new Set(resultado.ordenes.flatMap((o) => o.skusSinCosto))].sort();

  return (
    <>
      {formulario}
      {recortado && <p className={estilos.avisoError}>Hay demasiadas órdenes en este rango: acorta las fechas para ver todas.</p>}

      <div className={estilos.gridKpi}>
        <TarjetaKpi titulo="Ventas" valor={m(t.ventas)} detalle={[`${t.ordenesConReporte} órdenes con reporte · ${t.cantidad} unidades`]} />
        <TarjetaKpi
          titulo="Utilidad del periodo"
          valor={m(t.utilidadPeriodo)}
          detalle={[`Órdenes con costo ${m(t.utilidadOrdenes)}`, `Publicidad y servicios sin orden ${m(t.cargosSinOrden)}`]}
        />
        <TarjetaKpi titulo="% util" valor={mostrarPorcentaje(t.porcentajeUtilidad)} detalle={["Utilidad del periodo ÷ ventas de las órdenes con costo"]} />
        <TarjetaKpi
          titulo="Estimadas"
          valor={`${t.ordenesEstimadas} ${t.ordenesEstimadas === 1 ? "orden" : "órdenes"} · ${m(t.utilidadEstimadas)}`}
          detalle={
            t.ordenesEstimadas > 0
              ? [`Ventas ${m(t.ventasEstimadas)}`, "Con el último % de comisión y envío de cada SKU. No suman a la utilidad del periodo hasta llegar el reporte."]
              : undefined
          }
        />
        <TarjetaKpi
          titulo="Retenciones"
          valor={m(t.retenciones)}
          detalle={["Fuente, IVA e ICA. Saldo a favor en tus impuestos: no se restan de la utilidad."]}
        />
        <TarjetaKpi
          titulo="Falta costo"
          valor={`${t.ordenesFaltaCosto} ${t.ordenesFaltaCosto === 1 ? "orden" : "órdenes"} · ${m(t.ventasFaltaCosto)}`}
          detalle={t.ordenesFaltaCosto > 0 ? ["Fuera de la utilidad hasta tener costo en la maestra"] : undefined}
        />
        <TarjetaKpi
          titulo="Sin reporte de Falabella"
          valor={`${t.ordenesSinReporte} ${t.ordenesSinReporte === 1 ? "orden" : "órdenes"}`}
          detalle={t.ordenesSinReporte > 0 ? ["Carga el reporte de transacciones para calcularlas"] : undefined}
        />
      </div>

      {t.ordenesConflicto > 0 && (
        <p className={estilos.avisoError}>
          {t.ordenesConflicto} {t.ordenesConflicto === 1 ? "orden comparte" : "órdenes comparten"} el Nº de orden con otro pedido de la misma cuenta.
          No se calculan para no contar dos veces los mismos cobros: revísalas en Pedidos.
        </p>
      )}

      {puedeModificar && <DefectosCuentaFalabella cuentas={cuentas.map(({ id, nickname, comisionPct, flete }) => ({ id, nickname, comisionPct, flete }))} />}

      {skusSinCosto.length > 0 && (
        <p className={estilos.suave}>
          SKU sin costo en la maestra: {skusSinCosto.join(", ")}. Cárgales el costo en Finanzas → Maestra SKU.
        </p>
      )}

      <section className={estilos.seccion}>
        <h2 className={estilos.tituloSeccion}>Detalle por orden · Falabella</h2>
        {ordenesFiltradas.length === 0 ? (
          <EstadoVacio>No hay órdenes de Falabella en este rango.</EstadoVacio>
        ) : (
          <div className={estilos.tablaCompacta}>
            <Tabla
              encabezados={[
                "Orden",
                "Producto",
                "Fecha",
                "Cuenta",
                "Cnt",
                { clave: "ventas", contenido: "Ventas", numerica: true },
                { clave: "costo", contenido: "Costo", numerica: true },
                { clave: "comision", contenido: "Comisión", numerica: true },
                { clave: "envio", contenido: "Envío neto", numerica: true },
                { clave: "promo", contenido: "Promos", numerica: true },
                { clave: "otros", contenido: "Otros", numerica: true },
                { clave: "utilidad", contenido: "Utilidad", numerica: true },
                { clave: "pct", contenido: "% util", numerica: true },
                { clave: "ret", contenido: "Retenciones", numerica: true },
                "Estado",
              ]}
            >
              {ordenesPagina.map((o) => {
                const sinReporte = o.estado === "sin_reporte" || o.estado === "conflicto";
                // Sin reporte pero con ítems de la API: cantidad y ventas
                // sí se conocen; los cobros todavía no.
                const conVentasApi = o.estado === "sin_reporte" && o.cantidad > 0;
                const montoOrden = (valor: string | null) => (sinReporte ? "—" : m(valor));
                // El costo manual reemplaza el de la maestra en esta orden.
                const costoVisible = (
                  <>
                    {montoOrden(o.costo)}
                    {o.costoManual !== null && <div className={estilos.etiquetaManual}>Manual</div>}
                  </>
                );
                // Con flete manual, la nota «envío propio» cambia por
                // «Flete manual».
                const envioVisible = (
                  <>
                    {montoOrden(o.envios)}
                    {o.fleteManual !== null ? (
                      <div className={estilos.etiquetaManual}>Flete manual</div>
                    ) : (
                      o.envioPropio && <div className={estilos.suave}>Domiciliario · envío propio</div>
                    )}
                  </>
                );
                // En «conflicto» no se aplica ningún ajuste: sin lápiz.
                const lapiz = (campo: "costo" | "flete", contenido: React.ReactNode) =>
                  puedeModificar && o.estado !== "conflicto" ? (
                    <LapizMontoFalabella pedidoId={o.pedidoId} campo={campo} valorActual={campo === "costo" ? o.costoManual : o.fleteManual}>
                      {contenido}
                    </LapizMontoFalabella>
                  ) : (
                    contenido
                  );
                return (
                  <FilaTabla key={o.pedidoId}>
                    <CeldaTabla>
                      #{o.numero}
                      {o.numeroInterno && <div className={estilos.suave}>ID {o.numeroInterno}</div>}
                    </CeldaTabla>
                    <CeldaTabla>
                      <CeldaProducto productos={o.productos} />
                    </CeldaTabla>
                    <CeldaTabla>{fechaHoraBogota(o.fecha)}</CeldaTabla>
                    <CeldaTabla>{o.cuenta}</CeldaTabla>
                    <CeldaTabla>{sinReporte && !conVentasApi ? "—" : o.cantidad}</CeldaTabla>
                    <CeldaTabla numerica>{conVentasApi ? m(o.ventas) : montoOrden(o.ventas)}</CeldaTabla>
                    <CeldaTabla numerica>{lapiz("costo", costoVisible)}</CeldaTabla>
                    <CeldaTabla numerica>{montoOrden(o.comisiones)}</CeldaTabla>
                    <CeldaTabla numerica>{lapiz("flete", envioVisible)}</CeldaTabla>
                    <CeldaTabla numerica>{montoOrden(o.promociones)}</CeldaTabla>
                    <CeldaTabla numerica>{montoOrden(o.otros)}</CeldaTabla>
                    <CeldaTabla numerica>{montoOrden(o.utilidad)}</CeldaTabla>
                    <CeldaTabla numerica>{sinReporte ? "—" : mostrarPorcentaje(o.porcentajeUtilidad)}</CeldaTabla>
                    <CeldaTabla numerica>{montoOrden(o.retenciones)}</CeldaTabla>
                    <CeldaTabla>
                      <Chip estado={ETIQUETA_ESTADO[o.estado].chip} title={
                          o.numerosRepetidos.length > 0
                            ? `Repetido: ${o.numerosRepetidos.join(", ")}`
                            : o.skusSinCosto.length > 0
                              ? `Sin costo: ${o.skusSinCosto.join(", ")}`
                              : o.estado === "estimada"
                                ? "Con el último % de comisión y envío del SKU. Pasa a «Calculada» al cargar el reporte."
                                : undefined
                        }>
                        {ETIQUETA_ESTADO[o.estado].texto}
                      </Chip>
                    </CeldaTabla>
                  </FilaTabla>
                );
              })}
            </Tabla>
          </div>
        )}
        {totalPaginas > 1 && (
          <div className={estilos.paginacion}>
            <span className={estilos.suave}>
              Página {pagina} de {totalPaginas} · {ordenesFiltradas.length} órdenes
            </span>
            <div className={estilos.accionesFiltro}>
              {pagina > 1 && (
                <BotonLink href={href({ pagina: String(pagina - 1) })} variante="fantasma" chico>
                  Más nuevas
                </BotonLink>
              )}
              {pagina < totalPaginas && (
                <BotonLink href={href({ pagina: String(pagina + 1) })} variante="fantasma" chico>
                  Más viejas
                </BotonLink>
              )}
            </div>
          </div>
        )}
      </section>
    </>
  );
}
