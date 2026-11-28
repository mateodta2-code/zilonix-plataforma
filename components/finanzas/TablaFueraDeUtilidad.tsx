import Link from "next/link";
import { mostrarMonto } from "@/lib/finanzas/montos";
import { ETIQUETA_MOTIVO, totalizarFueraDeUtilidad, type MotivoFueraDeUtilidad, type VentaFueraDeUtilidad } from "@/lib/finanzas/fuera-de-utilidad";
import { Chip, type EstadoChip } from "@/components/marco/Chip";
import { CeldaTabla, FilaTabla, Tabla, type EncabezadoTabla } from "@/components/marco/Tabla";
import { EstadoVacio } from "@/components/marco/EstadoVacio";
import { TarjetaKpi } from "@/components/marco/TarjetaKpi";
import { fechaHoraBogota } from "./formato";
import estilos from "./ventasUtilidad.module.css";

// Pestaña «Canceladas y devoluciones» de Finanzas → Ventas (pedido de
// Sharel, 2026-11-28): el registro de las ventas que NO suman a la
// utilidad (lib/finanzas/fuera-de-utilidad.ts). Los montos son los que
// guardó la última sincronización; no se calcula una «pérdida» hasta
// confirmar con datos reales qué cobra Mercado Libre en estos casos.

const ENCABEZADOS: EncabezadoTabla[] = [
  { clave: "fecha", contenido: "Fecha" },
  { clave: "orden", contenido: "Orden" },
  { clave: "cuenta", contenido: "Cuenta" },
  { clave: "producto", contenido: "Producto" },
  { clave: "motivo", contenido: "Motivo" },
  { clave: "valor", contenido: "Valor venta", numerica: true },
  { clave: "reembolsado", contenido: "Reembolsado", numerica: true },
  { clave: "comision", contenido: "Comisión ML", numerica: true },
  { clave: "flete", contenido: "Flete ML", numerica: true },
];

const TONO_MOTIVO: Record<MotivoFueraDeUtilidad, EstadoChip> = {
  cancelada: "neutro",
  reembolso_total: "peligro",
  reembolso_parcial: "advertencia",
  reclamo_devolucion: "aviso",
};

const montoONada = (valor: string | null) => (valor === null ? "—" : mostrarMonto(valor));

export function TablaFueraDeUtilidad({ ventas, buscarTexto }: { ventas: VentaFueraDeUtilidad[]; buscarTexto: string }) {
  if (ventas.length === 0) {
    return (
      <EstadoVacio>
        {buscarTexto ? <>No hay canceladas ni devoluciones que coincidan con «{buscarTexto}» en este rango.</> : <>No hay ventas canceladas ni devueltas en este rango.</>}
      </EstadoVacio>
    );
  }

  const totales = totalizarFueraDeUtilidad(ventas);
  const detalleMotivos = (Object.entries(totales.porMotivo) as [MotivoFueraDeUtilidad, number][])
    .filter(([, n]) => n > 0)
    .map(([motivo, n]) => `${ETIQUETA_MOTIVO[motivo]}: ${n}`);

  return (
    <>
      <div className={estilos.gridKpi}>
        <TarjetaKpi titulo="Canceladas y devoluciones" valor={`${totales.ventas} ${totales.ventas === 1 ? "venta" : "ventas"}`} detalle={detalleMotivos} />
        <TarjetaKpi titulo="Valor de esas ventas" valor={mostrarMonto(totales.valorVenta)} detalle={["Lo que pagó el cliente, sin restar reembolsos"]} />
        <TarjetaKpi titulo="Reembolsado" valor={mostrarMonto(totales.reembolsos)} detalle={["Lo que Mercado Libre le devolvió al cliente"]} />
      </div>

      <section className={estilos.seccion}>
        <h2 className={estilos.tituloSeccion}>Canceladas y devoluciones</h2>
        <p className={estilos.suave}>
          Estas ventas no suman a la utilidad. Entran aquí las canceladas, las que tienen reembolso (total o parcial) y las que tienen un reclamo de
          devolución en Productos → Devoluciones. Los montos son los que trajo Mercado Libre en la última sincronización.
        </p>
        <Tabla encabezados={ENCABEZADOS} scroll>
          {ventas.map((v) => (
            <FilaTabla key={v.pedidoId}>
              <CeldaTabla>{fechaHoraBogota(v.fechaCreacion)}</CeldaTabla>
              <CeldaTabla>
                <Link href={`/panel/finanzas/ventas/${v.pedidoId}`} className={estilos.enlace}>
                  #{v.pedidoIdExterno}
                </Link>
              </CeldaTabla>
              <CeldaTabla>{v.cuenta}</CeldaTabla>
              <CeldaTabla>
                {v.productos.length === 0
                  ? "—"
                  : v.productos.map((p, i) => (
                      <div key={i}>
                        {p.titulo}
                        <span className={estilos.suave}>
                          {p.sku ? ` · ${p.sku}` : ""} · {p.cantidad} {p.cantidad === 1 ? "unidad" : "unidades"}
                        </span>
                      </div>
                    ))}
              </CeldaTabla>
              <CeldaTabla>
                <Chip estado={TONO_MOTIVO[v.motivo]} title={`Estado en Mercado Libre: ${v.estado}`}>
                  {ETIQUETA_MOTIVO[v.motivo]}
                </Chip>
              </CeldaTabla>
              <CeldaTabla numerica>{mostrarMonto(v.valorVenta)}</CeldaTabla>
              <CeldaTabla numerica>{mostrarMonto(v.reembolsos)}</CeldaTabla>
              <CeldaTabla numerica>{montoONada(v.comisionMl)}</CeldaTabla>
              <CeldaTabla numerica>{montoONada(v.fleteMl)}</CeldaTabla>
            </FilaTabla>
          ))}
        </Tabla>
      </section>
    </>
  );
}
