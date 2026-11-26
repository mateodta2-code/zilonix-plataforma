import { FotoConZoom } from "@/components/marco/FotoConZoom";
import { formatearFechaPedido } from "@/lib/pedidos/marketplace";
import { rotuloEstadoEnvio, type VentaPosventa } from "@/lib/ml/mensajesPosventa";
import { datosSitioMl, formatearMonedaIso, formatearNumero } from "@/lib/ml/sitios";
import styles from "../../Mensajes.module.css";

// Columna derecha del chat: la venta, en vivo. Sin «Adjuntar factura»
// (queda fuera de esta parte).
export function FichaVentaPosventa({ ordenId, venta, siteId }: { ordenId: string; venta: VentaPosventa | null; siteId: string | null }) {
  const sitio = datosSitioMl(siteId);
  const moneda = venta?.moneda ?? sitio.moneda;
  const fecha = venta?.fecha && Number.isFinite(Date.parse(venta.fecha)) ? formatearFechaPedido(new Date(venta.fecha), moneda) : null;
  const envio = rotuloEstadoEnvio(venta?.estadoEnvio ?? null);
  return (
    <aside className={styles.ficha} aria-label="Venta">
      <h2 className={styles.fichaTitulo}>Venta #{ordenId}</h2>
      {!venta && <p className={styles.vacio}>No se pudo leer la venta en Mercado Libre.</p>}
      {(fecha || venta?.ciudad) && <p className={styles.fichaTexto}>{[fecha, venta?.ciudad].filter(Boolean).join(" | ")}</p>}
      {envio && <p className={styles.fichaTexto}>Estado del envío: {envio}</p>}
      {venta?.productos.map((p, i) => (
        <div key={`${p.itemId}-${i}`} className={styles.producto}>
          {p.foto && <FotoConZoom src={p.foto} alt={p.titulo ?? "Producto"} claseMiniatura={styles.foto} />}
          <div>
            <p className={styles.titulo}>{p.titulo ?? "Producto"}</p>
            {p.variaciones.length > 0 && <p className={styles.detalle}>{p.variaciones.map((v) => `${v.nombre}: ${v.valor}`).join(" | ")}</p>}
            {p.precioUnitario !== null && (
              <p className={styles.detalle}>
                {formatearMonedaIso(p.precioUnitario, p.moneda ?? moneda)}
                {p.cantidad !== null && ` x ${formatearNumero(p.cantidad, sitio.idioma)} ${p.cantidad === 1 ? "unidad" : "unidades"}`}
              </p>
            )}
          </div>
        </div>
      ))}
    </aside>
  );
}
