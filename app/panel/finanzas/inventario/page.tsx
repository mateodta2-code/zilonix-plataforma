import Link from "next/link";
import { obtenerContextoPanel } from "@/lib/panel-contexto";
import { normalizarParametro } from "@/lib/filtros-listado";
import { leerInventarioValorizado } from "@/lib/finanzas/inventario-valorizado-db";
import { UBICACIONES, ubicacionValida, type Ubicacion } from "@/lib/finanzas/inventario-valorizado";
import { formatearFechaPedido, formatearMontoEnMoneda } from "@/lib/pedidos/marketplace";
import { requierePermiso, SinPermisoError } from "@/lib/permisos";
import { Boton, BotonLink } from "@/components/marco/Boton";
import { Campo } from "@/components/marco/Campo";
import { Chip } from "@/components/marco/Chip";
import { CeldaTabla, FilaTabla, Tabla } from "@/components/marco/Tabla";
import { EncabezadoPagina } from "@/components/marco/EncabezadoPagina";
import { EstadoVacio } from "@/components/marco/EstadoVacio";
import { SinAcceso } from "@/components/marco/SinAcceso";
import { TarjetaKpi } from "@/components/marco/TarjetaKpi";
import styles from "../finanzas.module.css";

const ETIQUETA_UBICACION: Record<Ubicacion, string> = Object.fromEntries(UBICACIONES.map((u) => [u.valor, u.etiqueta])) as Record<Ubicacion, string>;

// Issue #422 — inventario valorizado: cuánta plata hay en mercancía.
// Solo lee: exige finanzas.consultar. Bodegas (propias y 3PL) y Full
// salen de stock_bodega; Falabella no tiene stock en la plataforma
// todavía. Lo pendiente de las OC abiertas o parciales va aparte como
// "Mercancía en camino" (no suma al total en inventario: todavía no
// llegó). El cálculo vive en lib/finanzas/inventario-valorizado.ts.
export default async function InventarioValorizadoPage({ searchParams }: { searchParams: Record<string, string | string[] | undefined> }) {
  const { usuario, activa: empresa, rolNombre } = await obtenerContextoPanel();
  try {
    await requierePermiso(usuario.id, empresa.id, "finanzas", "consultar");
  } catch (error) {
    if (!(error instanceof SinPermisoError)) throw error;
    return <SinAcceso mensaje={`Tu rol (${rolNombre}) no tiene acceso a Finanzas.`} />;
  }

  const datos = await leerInventarioValorizado(empresa.id);
  const { moneda, totales, enCamino } = datos;
  const dinero = (valor: string) => formatearMontoEnMoneda(valor, moneda);

  // Lista blanca: la tienda tiene que ser una cuenta de esta empresa.
  const tiendaPedida = normalizarParametro(searchParams.tienda);
  const tienda = datos.tiendas.find((t) => t.id === tiendaPedida);
  const ubicacion = ubicacionValida(normalizarParametro(searchParams.ubicacion));
  const hayFiltros = Boolean(tienda || ubicacion);

  const filas = datos.lineas.filter(
    (l) => (!ubicacion || l.ubicacion === ubicacion) && (!tienda || datos.tiendasPorSku.get(l.skuId)?.has(tienda.id))
  );

  const detalleFull =
    datos.bodegasFull.length === 0
      ? ["No hay una bodega de Full creada en Inventario → Bodegas."]
      : [
          "Stock cargado a mano en el inventario: todavía no se lee de Mercado Libre.",
          ...datos.bodegasFull.map(
            (b) => `${b.nombre}: último movimiento ${b.ultimoMovimiento ? formatearFechaPedido(b.ultimoMovimiento, moneda) : "ninguno"}.`
          ),
        ];

  return (
    <>
      <EncabezadoPagina
        titulo="Inventario valorizado"
        descripcion="Cuánta plata tiene la empresa en mercancía: unidades (disponibles + reservadas) × costo de la Tabla maestra de SKU."
      />

      <section className={styles.tablero}>
        <div className={styles.gridKpi}>
          <TarjetaKpi
            titulo="Total en inventario"
            valor={dinero(totales.total)}
            detalle={[
              "Bodegas propias, 3PL y Full. Sin la mercancía en camino.",
              ...(totales.skusSinCosto > 0 ? ["No incluye los SKU sin costo."] : []),
            ]}
          />
          <TarjetaKpi titulo="Bodegas propias y 3PL" valor={dinero(totales.porUbicacion.bodegas)} />
          <TarjetaKpi titulo="Full de Mercado Libre" valor={dinero(totales.porUbicacion.full)} detalle={detalleFull} />
          <TarjetaKpi
            titulo="Fulfillment Falabella"
            textoVacio="Sin datos todavía"
            detalle={["La plataforma todavía no trae el stock de Falabella."]}
          />
          <TarjetaKpi
            titulo="SKU sin costo"
            valor={totales.skusSinCosto}
            detalle={
              totales.skusSinCosto > 0
                ? [`${totales.unidadesSinCosto} unidades quedan fuera del total por falta de costo.`]
                : ["Todo el stock tiene costo en la maestra."]
            }
          />
        </div>
      </section>

      {totales.skusSinCosto > 0 && (
        <p className={styles.avisoError}>
          Hay {totales.skusSinCosto} SKU con stock y sin costo: van como «Falta costo» y no suman al total.{" "}
          <Link href="/panel/finanzas/maestra-sku?sinCosto=1" className={styles.enlace}>
            Cargar costos en la Tabla maestra de SKU
          </Link>
        </p>
      )}

      <h2 className={styles.tituloSeccion}>Por producto y ubicación</h2>
      <form method="get" className={styles.filtros}>
        <Campo etiqueta="Tienda">
          <select name="tienda" defaultValue={tienda?.id ?? ""} className="zx-control">
            <option value="">Todas</option>
            {datos.tiendas.map((t) => (
              <option key={t.id} value={t.id}>
                {t.nombre}
              </option>
            ))}
          </select>
        </Campo>
        <Campo etiqueta="Ubicación">
          <select name="ubicacion" defaultValue={ubicacion ?? ""} className="zx-control">
            <option value="">Todas</option>
            {UBICACIONES.map((u) => (
              <option key={u.valor} value={u.valor}>
                {u.etiqueta}
              </option>
            ))}
          </select>
        </Campo>
        <div className={styles.accionesFiltro}>
          <Boton type="submit" chico>
            Filtrar
          </Boton>
          {hayFiltros && (
            <BotonLink href="/panel/finanzas/inventario" variante="fantasma" chico>
              Limpiar filtros
            </BotonLink>
          )}
        </div>
      </form>
      {tienda && <p className={styles.ayuda}>Tienda: los SKU publicados en esa cuenta de Mercado Libre. El stock es de la empresa, no de la cuenta.</p>}

      {ubicacion === "falabella" ? (
        <EstadoVacio>Sin datos todavía: la plataforma no trae el stock de fulfillment de Falabella.</EstadoVacio>
      ) : filas.length === 0 ? (
        <EstadoVacio>{hayFiltros ? "Ningún producto coincide con los filtros." : "No hay stock cargado en el inventario."}</EstadoVacio>
      ) : (
        <Tabla encabezados={["SKU", "Producto", "Ubicación", "Unidades", "Costo unitario", "Valor"]}>
          {filas.map((l) => (
            <FilaTabla key={`${l.skuId}:${l.bodegaId}`}>
              <CeldaTabla>
                <strong>{l.codigo}</strong>
              </CeldaTabla>
              <CeldaTabla>{l.nombre}</CeldaTabla>
              <CeldaTabla>
                {l.bodegaNombre}
                <br />
                <span className={styles.suave}>{ETIQUETA_UBICACION[l.ubicacion]}</span>
              </CeldaTabla>
              <CeldaTabla>{l.unidades}</CeldaTabla>
              <CeldaTabla>
                {l.costoUnitario === null ? (
                  <Chip estado="peligro">Falta costo</Chip>
                ) : (
                  <>
                    {dinero(l.costoUnitario)}
                    {l.origenCosto === "combo_base" && (
                      <>
                        <br />
                        <span className={styles.suave}>combo, del SKU base</span>
                      </>
                    )}
                  </>
                )}
              </CeldaTabla>
              <CeldaTabla>{l.valor === null ? "—" : dinero(l.valor)}</CeldaTabla>
            </FilaTabla>
          ))}
        </Tabla>
      )}

      <section className={styles.tablero}>
        <h2 className={styles.tituloSeccion}>Mercancía en camino</h2>
        <p className={styles.ayuda}>
          Lo pedido y aún no recibido de las órdenes de compra abiertas o parciales. No suma al total en inventario hasta que se recibe.
        </p>
        <div className={styles.gridKpi}>
          <TarjetaKpi
            titulo="Total en camino"
            valor={dinero(enCamino.total)}
            detalle={[
              "Al costo de la orden de compra; si la línea no lo trae, al de la maestra.",
              ...(enCamino.lineasSinCosto > 0 ? [`${enCamino.lineasSinCosto} líneas sin costo quedan fuera.`] : []),
            ]}
          />
        </div>
      </section>
      {enCamino.lineas.length === 0 ? (
        <EstadoVacio>No hay órdenes de compra con mercancía pendiente.</EstadoVacio>
      ) : (
        <Tabla encabezados={["Orden", "SKU", "Producto", "Unidades pendientes", "Costo unitario", "Costo de", "Valor"]}>
          {enCamino.lineas.map((l) => (
            <FilaTabla key={`${l.ordenNumero}:${l.skuId}`}>
              <CeldaTabla>OC #{l.ordenNumero}</CeldaTabla>
              <CeldaTabla>
                <strong>{l.codigo}</strong>
              </CeldaTabla>
              <CeldaTabla>{l.nombre}</CeldaTabla>
              <CeldaTabla>{l.unidades}</CeldaTabla>
              <CeldaTabla>{l.costoUnitario === null ? <Chip estado="peligro">Falta costo</Chip> : dinero(l.costoUnitario)}</CeldaTabla>
              <CeldaTabla>{l.origenCosto === "orden" ? "La orden de compra" : l.origenCosto === "maestra" ? "La maestra" : "—"}</CeldaTabla>
              <CeldaTabla>{l.valor === null ? "—" : dinero(l.valor)}</CeldaTabla>
            </FilaTabla>
          ))}
        </Tabla>
      )}

      <div className={styles.accionesFiltro}>
        <BotonLink href="/panel/finanzas" variante="fantasma" chico className={styles.volver}>
          Volver a Finanzas
        </BotonLink>
      </div>
    </>
  );
}
