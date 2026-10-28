import { notFound } from "next/navigation";
import { obtenerContextoPanel } from "@/lib/panel-contexto";
import { mostrarMonto } from "@/lib/finanzas/montos";
import { obtenerDetalleVentaUtilidad } from "@/lib/finanzas/ventas-consulta";
import type { ValorConcepto } from "@/lib/finanzas/utilidad-venta";
import { requierePermiso, SinPermisoError } from "@/lib/permisos";
import { BotonLink } from "@/components/marco/Boton";
import { Chip } from "@/components/marco/Chip";
import { CeldaTabla, FilaTabla, Tabla } from "@/components/marco/Tabla";
import { EncabezadoPagina } from "@/components/marco/EncabezadoPagina";
import { SinAcceso } from "@/components/marco/SinAcceso";
import { ETIQUETA_AVISO, ETIQUETA_CAMPO, ETIQUETA_FORMA, ETIQUETA_ORIGEN, fechaHoraBogota, mostrarPorcentaje } from "../formato";
import estilos from "../ventas.module.css";
import styles from "../../finanzas.module.css";

function Origen({ valor }: { valor: ValorConcepto }) {
  return (
    <>
      {mostrarMonto(valor.valor)}
      <br />
      <span className={styles.suave}>{ETIQUETA_ORIGEN[valor.origen]}</span>
    </>
  );
}

// Issue #131 (Z-FIN-09, Parte A) — detalle de una venta, SOLO LECTURA:
// cada resta con su origen ("valor congelado", "corregido a mano" o
// "Full ML ($0)"), las correcciones activas y anuladas con quién y
// cuándo (hora de Bogotá), los avisos del motor y la utilidad. Corregir
// y anular es la Parte B.
export default async function DetalleVentaUtilidadPage({ params }: { params: { pedidoId: string } }) {
  const { usuario, activa: empresa, rolNombre } = await obtenerContextoPanel();

  try {
    await requierePermiso(usuario.id, empresa.id, "finanzas", "consultar");
  } catch (error) {
    if (!(error instanceof SinPermisoError)) throw error;
    return <SinAcceso mensaje={`Tu rol (${rolNombre}) no tiene acceso a Finanzas.`} />;
  }

  // Un id que no es de esta empresa (o no tiene foto financiera) es 404:
  // RLS ya lo filtra y la consulta exige además empresa_id.
  const venta = await obtenerDetalleVentaUtilidad(empresa.id, usuario.id, params.pedidoId);
  if (!venta) notFound();

  const r = venta.resultado;
  const avisos = [...venta.avisosArmado, ...(r?.avisos ?? [])];

  return (
    <>
      <EncabezadoPagina
        titulo={`Venta #${venta.pedidoIdExterno}`}
        descripcion={
          <>
            {venta.nickname} · creada el {fechaHoraBogota(venta.fechaCreacion)} · {ETIQUETA_FORMA[venta.formaEntrega]}
            {venta.fechaPagoAprobado && <> · pago aprobado el {fechaHoraBogota(venta.fechaPagoAprobado)}</>}
          </>
        }
      />

      <div className={estilos.marcas}>
        <Chip>{venta.estado}</Chip>
        {venta.cancelada && <Chip estado="peligro">cancelada: no suma</Chip>}
        {venta.conDevolucion &&<Chip estado="peligro">con devolución · revisar ({mostrarMonto(venta.reembolsos)})</Chip>}
        {venta.congeladoTs ? (
          <Chip estado="exito">foto congelada el {fechaHoraBogota(venta.congeladoTs)}</Chip>
        ) : (
          <Chip estado="aviso">sin congelar ({venta.estadoCosteo.replace("_", " ")})</Chip>
        )}
      </div>

      {venta.error && <p className={styles.avisoError}>El motor no pudo calcular esta venta: {venta.error}</p>}

      {avisos.length > 0 && (
        <div className={styles.aviso}>
          Avisos:
          <ul className={estilos.listaSimple}>
            {avisos.map((a) => (
              <li key={a}>{ETIQUETA_AVISO[a]}</li>
            ))}
          </ul>
        </div>
      )}

      {r && (
        <section className={styles.seccion}>
          <h2 className={styles.tituloSeccion}>Desglose de la venta</h2>
          <Tabla encabezados={["Concepto", "Valor"]}>
            <FilaTabla>
              <CeldaTabla>Recaudo ventas (lo que pagó el cliente)</CeldaTabla>
              <CeldaTabla className={estilos.numero}>{mostrarMonto(r.valor_venta)}</CeldaTabla>
            </FilaTabla>
            <FilaTabla>
              <CeldaTabla>− Comisión ML</CeldaTabla>
              <CeldaTabla className={estilos.numero}>
                <Origen valor={r.comision_ml} />
              </CeldaTabla>
            </FilaTabla>
            <FilaTabla>
              <CeldaTabla>− Flete ML</CeldaTabla>
              <CeldaTabla className={estilos.numero}>
                <Origen valor={r.flete_ml} />
              </CeldaTabla>
            </FilaTabla>
            <FilaTabla>
              <CeldaTabla>− Costo producto</CeldaTabla>
              <CeldaTabla className={estilos.numero}>{r.costo_producto ? <Origen valor={r.costo_producto} /> : <Chip estado="aviso">sin costo</Chip>}</CeldaTabla>
            </FilaTabla>
            <FilaTabla>
              <CeldaTabla>− Packing (una vez por paquete)</CeldaTabla>
              <CeldaTabla className={estilos.numero}>
                <Origen valor={r.empaque} />
              </CeldaTabla>
            </FilaTabla>
            <FilaTabla>
              <CeldaTabla>− Envío agencia (una vez por paquete)</CeldaTabla>
              <CeldaTabla className={estilos.numero}>
                <Origen valor={r.envio} />
              </CeldaTabla>
            </FilaTabla>
            <FilaTabla>
              <CeldaTabla>− Devolución</CeldaTabla>
              {/* Concepto aparte con #164; hoy no resta. */}
              <CeldaTabla className={estilos.numero}>—</CeldaTabla>
            </FilaTabla>
            <FilaTabla>
              <CeldaTabla>
                <strong>Utilidad (antes de publicidad)</strong>
              </CeldaTabla>
              <CeldaTabla className={estilos.numero}>
                <strong>{r.utilidad === null ? "—" : mostrarMonto(r.utilidad)}</strong>
                <br />
                <span className={styles.suave}>margen {mostrarPorcentaje(r.margen_porcentaje)}</span>
              </CeldaTabla>
            </FilaTabla>
          </Tabla>
        </section>
      )}

      {r && (
        <section className={styles.seccion}>
          <h2 className={styles.tituloSeccion}>Por línea</h2>
          <Tabla encabezados={["", "Producto", "Cnt", "Recaudo", "Comisión ML", "Flete ML", "Costo producto", "Packing", "Envío agencia", "Utilidad", "% util"]}>
            {r.lineas.map((l) => {
              const dato = venta.lineas.find((d) => d.linea === l.linea);
              return (
                <FilaTabla key={l.linea}>
                  <CeldaTabla>
                    {dato?.imagenUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element -- miniatura externa de ML, sin optimizar
                      <img src={dato.imagenUrl} alt="" className={estilos.miniatura} />
                    ) : null}
                  </CeldaTabla>
                  <CeldaTabla>
                    {dato?.titulo ?? `Línea ${l.linea}`} <span className={styles.suave}>[{dato?.skuCodigo ?? "sin SKU"}]</span>
                  </CeldaTabla>
                  <CeldaTabla className={estilos.numero}>{l.cantidad}</CeldaTabla>
                  <CeldaTabla className={estilos.numero}>{mostrarMonto(l.valor_venta)}</CeldaTabla>
                  <CeldaTabla className={estilos.numero}>
                    <Origen valor={l.comision_ml} />
                  </CeldaTabla>
                  <CeldaTabla className={estilos.numero}>
                    <Origen valor={l.flete_ml} />
                  </CeldaTabla>
                  <CeldaTabla className={estilos.numero}>{l.costo_producto ? <Origen valor={l.costo_producto} /> : <Chip estado="aviso">sin costo</Chip>}</CeldaTabla>
                  <CeldaTabla className={estilos.numero}>
                    <Origen valor={l.empaque} />
                  </CeldaTabla>
                  <CeldaTabla className={estilos.numero}>
                    <Origen valor={l.envio} />
                  </CeldaTabla>
                  <CeldaTabla className={estilos.numero}>{l.utilidad === null ? "—" : mostrarMonto(l.utilidad)}</CeldaTabla>
                  <CeldaTabla className={estilos.numero}>{mostrarPorcentaje(l.margen_porcentaje)}</CeldaTabla>
                </FilaTabla>
              );
            })}
          </Tabla>
        </section>
      )}

      <section className={styles.seccion}>
        <h2 className={styles.tituloSeccion}>Correcciones manuales</h2>
        {venta.correcciones.length === 0 ? (
          <p className={styles.suave}>Esta venta no tiene correcciones.</p>
        ) : (
          <Tabla encabezados={["Campo", "Línea", "Valor nuevo", "Nota", "Quién", "Cuándo", "Estado"]}>
            {venta.correcciones.map((c) => (
              <FilaTabla key={c.id}>
                <CeldaTabla className={c.anuladaTs ? estilos.anulada : undefined}>{ETIQUETA_CAMPO[c.campo] ?? c.campo}</CeldaTabla>
                <CeldaTabla>{c.linea === null ? "Toda la venta" : c.linea}</CeldaTabla>
                <CeldaTabla className={estilos.numero}>{mostrarMonto(c.valorNuevo)}</CeldaTabla>
                <CeldaTabla>{c.nota}</CeldaTabla>
                <CeldaTabla>{c.creadoPorNombre}</CeldaTabla>
                <CeldaTabla>{fechaHoraBogota(c.creadoTs)}</CeldaTabla>
                <CeldaTabla>
                  {c.anuladaTs ? <Chip>anulada el {fechaHoraBogota(c.anuladaTs)}</Chip> : <Chip estado="exito">activa</Chip>}
                </CeldaTabla>
              </FilaTabla>
            ))}
          </Tabla>
        )}
      </section>

      <div className={styles.accionesFiltro}>
        <BotonLink href={`/panel/pedidos/${venta.pedidoId}`} variante="fantasma" chico className={styles.volver}>
          Ver el pedido
        </BotonLink>
        <BotonLink href="/panel/finanzas/ventas" variante="fantasma" chico className={styles.volver}>
          Volver a ventas y utilidad
        </BotonLink>
      </div>
    </>
  );
}
