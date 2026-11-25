import Link from "next/link";
import { FotoConZoom } from "@/components/marco/FotoConZoom";
import { formatearFechaPedido } from "@/lib/pedidos/marketplace";
import type { DetalleReclamoMl } from "@/lib/ml/reclamos";
import { formatearMonedaIso, formatearNumero, datosSitioMl } from "@/lib/ml/sitios";
import { minutosHasta, textoPlazo } from "@/lib/preguntas/tiempo";
import styles from "./DetalleReclamo.module.css";

export function FichaVentaReclamo({
  detalle,
  siteId,
  pedidoZilonixId,
  ahora,
}: {
  detalle: DetalleReclamoMl;
  siteId: string | null;
  // id del pedido en Zilonix, si esa venta ya se importó.
  pedidoZilonixId: string | null;
  ahora: Date;
}) {
  const { venta, plazo } = detalle;
  const sitio = datosSitioMl(siteId);
  const moneda = venta.moneda ?? sitio.moneda;
  const fecha = venta.fecha && Number.isFinite(Date.parse(venta.fecha)) ? formatearFechaPedido(new Date(venta.fecha), moneda) : null;
  const minutos = minutosHasta(plazo, ahora);
  const urgente = minutos !== null && minutos < 24 * 60;

  return (
    <aside className={styles.ficha} aria-label="Venta del reclamo">
      <h2 className={styles.fichaTitulo}>{venta.ordenId ? `Venta #${venta.ordenId}` : "Venta"}</h2>
      {(fecha || venta.ciudad) && <p className={styles.fichaFecha}>{[fecha, venta.ciudad].filter(Boolean).join(" | ")}</p>}

      {plazo && (
        <div className={`${styles.alertaPlazo} ${urgente ? styles.alertaPeligro : ""}`} role="status">
          <strong>Reclamo abierto para resolver ({textoPlazo(minutos)})</strong>
          <span>Si no ofreces una solución, el comprador decidirá cómo continuar.</span>
        </div>
      )}

      {venta.aviso && <p className={styles.vacio}>{venta.aviso}</p>}

      {venta.productos.map((p, i) => (
        <div key={`${p.itemId}-${i}`} className={styles.producto}>
          {p.foto && <FotoConZoom src={p.foto} alt={p.titulo ?? "Producto"} claseMiniatura={styles.fotoProducto} />}
          <div>
            <p className={styles.productoTitulo}>{p.titulo ?? "Producto"}</p>
            {p.variaciones.length > 0 && <p className={styles.productoDetalle}>{p.variaciones.map((v) => `${v.nombre}: ${v.valor}`).join(" | ")}</p>}
            {p.precioUnitario !== null && (
              <p className={styles.productoDetalle}>
                {formatearMonedaIso(p.precioUnitario, p.moneda ?? moneda)}
                {p.cantidad !== null && ` x ${formatearNumero(p.cantidad, sitio.idioma)} ${p.cantidad === 1 ? "unidad" : "unidades"}`}
              </p>
            )}
          </div>
        </div>
      ))}

      {pedidoZilonixId && (
        <Link href={`/panel/pedidos/${pedidoZilonixId}`} className={styles.enlace}>
          Ver la venta en Pedidos
        </Link>
      )}
    </aside>
  );
}
