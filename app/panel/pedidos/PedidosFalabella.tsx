import { listarPedidosParaPantalla } from "@/lib/falabella/pedidos";
import { MARKETPLACES, formatearFechaPedido, formatearMontoEnMoneda, productosDeItemsFalabella } from "@/lib/pedidos/marketplace";
import { CeldaTabla, FilaTabla, Tabla } from "@/components/marco/Tabla";
import { EstadoVacio } from "@/components/marco/EstadoVacio";
import estilos from "@/components/finanzas/ventasUtilidad.module.css";
import styles from "./page.module.css";

// Issue #422 — pedidos de Falabella en /panel/pedidos. Solo lectura, del
// rango que ya resolvió la página (el mismo filtro de mes del detalle de
// Mercado Libre). Falabella no trae comisión, envío ni costo en lo que
// guarda el conector: esas columnas van con "—", nunca con un número
// inventado.
const ENCABEZADOS = [
  "Fecha",
  "Pedido",
  "Marketplace · cuenta",
  "Productos",
  { clave: "total", contenido: "Total", numerica: true },
  { clave: "comision", contenido: "Comisión", numerica: true },
  { clave: "envio", contenido: "Envío", numerica: true },
  { clave: "costo", contenido: "Costo", numerica: true },
  "Estado",
  "Moneda",
];

const SIN_DATO = "—";

type ResultadoPedidos = Awaited<ReturnType<typeof listarPedidosParaPantalla>>;

export async function PedidosFalabella({ empresaId, rango }: { empresaId: string; rango: { desde: Date; hastaExclusivo: Date } }) {
  const { pedidos, truncado } = await listarPedidosParaPantalla(empresaId, rango);
  return <TablaPedidosFalabella pedidos={pedidos} truncado={truncado} />;
}

// Parte sincrónica (sin base): se prueba sola con renderToStaticMarkup.
export function TablaPedidosFalabella({ pedidos, truncado }: ResultadoPedidos) {
  const marketplace = MARKETPLACES.find((m) => m.valor === "falabella")?.etiqueta;

  return (
    <section className={estilos.seccion}>
      <h2 className={styles.tituloMarketplace}>Pedidos de Falabella</h2>
      {pedidos.length === 0 ? (
        <EstadoVacio>No hay pedidos de Falabella en este rango de fechas.</EstadoVacio>
      ) : (
        <>
          {truncado && (
            <p className={estilos.suave}>Se muestran los {pedidos.length} pedidos más nuevos del rango; acorta las fechas para ver el resto.</p>
          )}
          <Tabla encabezados={ENCABEZADOS}>
            {pedidos.map((p) => {
              const productos = productosDeItemsFalabella(p.items);
              return (
                <FilaTabla key={p.id}>
                  <CeldaTabla>{formatearFechaPedido(p.fecha, p.moneda)}</CeldaTabla>
                  <CeldaTabla>#{p.pedidoIdExterno}</CeldaTabla>
                  <CeldaTabla>
                    <span className={styles.marketplace}>{marketplace}</span> · {p.cuenta}
                  </CeldaTabla>
                  <CeldaTabla>
                    {productos.length === 0 ? (
                      SIN_DATO
                    ) : (
                      <ul className={styles.productos}>
                        {productos.map((producto, i) => (
                          <li key={i}>
                            {producto.nombre}
                            {producto.sku && <span className={estilos.suave}> · SKU {producto.sku}</span>}
                          </li>
                        ))}
                      </ul>
                    )}
                  </CeldaTabla>
                  <CeldaTabla numerica>{formatearMontoEnMoneda(p.total, p.moneda)}</CeldaTabla>
                  <CeldaTabla numerica>{SIN_DATO}</CeldaTabla>
                  <CeldaTabla numerica>{SIN_DATO}</CeldaTabla>
                  <CeldaTabla numerica>{SIN_DATO}</CeldaTabla>
                  <CeldaTabla>{p.estado}</CeldaTabla>
                  <CeldaTabla>{p.moneda}</CeldaTabla>
                </FilaTabla>
              );
            })}
          </Tabla>
        </>
      )}
    </section>
  );
}
