import { randomUUID } from "crypto";
import { notFound } from "next/navigation";
import { requierePermiso, SinPermisoError } from "@/lib/permisos";
import { obtenerContextoPanel } from "@/lib/panel-contexto";
import { tienePermiso } from "@/lib/roles";
import { listarBodegas } from "@/lib/inventario/bodegas";
import { obtenerOrdenCompra } from "@/lib/inventario/compras";
import { mostrarMonto } from "@/lib/finanzas/montos";
import { anularOrdenCompraAction, recibirOrdenCompraAction } from "../actions";
import { Boton, BotonLink } from "@/components/marco/Boton";
import { Campo } from "@/components/marco/Campo";
import { Chip } from "@/components/marco/Chip";
import { EncabezadoPagina } from "@/components/marco/EncabezadoPagina";
import { SinAcceso } from "@/components/marco/SinAcceso";
import { CeldaTabla, FilaTabla, Tabla } from "@/components/marco/Tabla";
import { Tarjeta } from "@/components/marco/Tarjeta";
import { AvisosUrl, SeccionesInventario } from "@/components/inventario/Avisos";
import { ESTADO_OC } from "@/components/inventario/estados";
import styles from "../../inventario.module.css";

// Issue #280 — detalle de una OC y su recepción. Ver pide
// inventario.consultar; recibir, inventario.crear; anular,
// inventario.anular (también en cada acción). Se puede recibir en
// varias veces (parcial) y de más (el proveedor mandó extra).
export default async function OrdenCompraPage({
  params,
  searchParams,
}: {
  params: { id: string };
  searchParams: Record<string, string | string[] | undefined>;
}) {
  const { usuario, activa, permisos, rolNombre } = await obtenerContextoPanel();
  try {
    await requierePermiso(usuario.id, activa.id, "inventario", "consultar");
  } catch (error) {
    if (!(error instanceof SinPermisoError)) throw error;
    return <SinAcceso mensaje={`Tu rol (${rolNombre}) no tiene acceso a esta pantalla.`} />;
  }
  const orden = await obtenerOrdenCompra(activa.id, params.id);
  if (!orden) notFound();
  const abierta = orden.estado === "abierta" || orden.estado === "parcial";
  const puedeRecibir = abierta && tienePermiso(permisos, "inventario", "crear");
  const puedeAnular = orden.estado === "abierta" && tienePermiso(permisos, "inventario", "anular");
  const bodegasActivas = puedeRecibir ? await listarBodegas(activa.id, { soloActivas: true }) : [];

  return (
    <>
      <EncabezadoPagina
        titulo={`OC-${orden.numero}`}
        descripcion={`${orden.proveedor ?? "Sin proveedor"} · llega a ${orden.bodega}${orden.nota ? ` · ${orden.nota}` : ""}`}
        accion={<Chip estado={ESTADO_OC[orden.estado]?.estado ?? "neutro"}>{ESTADO_OC[orden.estado]?.texto ?? orden.estado}</Chip>}
      />
      <SeccionesInventario actual="/panel/inventario/compras" />
      <AvisosUrl searchParams={searchParams} />

      {puedeRecibir ? (
        <form action={recibirOrdenCompraAction} className={styles.form}>
          <input type="hidden" name="recepcionId" value={randomUUID()} />
          <input type="hidden" name="ordenCompraId" value={orden.id} />
          <Tabla encabezados={["SKU", "Pedido", "Recibido", "Pendiente", "Costo unit.", "Llegó ahora"]}>
            {orden.lineas.map((l, i) => (
              <FilaTabla key={l.id}>
                <CeldaTabla>
                  <strong>{l.codigo}</strong>
                  <div className={styles.detalle}>{l.nombre}</div>
                </CeldaTabla>
                <CeldaTabla className={styles.numero}>{l.cantidadPedida}</CeldaTabla>
                <CeldaTabla className={styles.numero}>{l.cantidadRecibida}</CeldaTabla>
                <CeldaTabla className={styles.numero}>{Math.max(0, l.cantidadPedida - l.cantidadRecibida)}</CeldaTabla>
                <CeldaTabla className={styles.numero}>{mostrarMonto(l.costoUnitario)}</CeldaTabla>
                <CeldaTabla>
                  <input type="hidden" name={`sku_${i}`} value={l.skuId} />
                  <input
                    name={`cantidad_${i}`}
                    type="number"
                    min={0}
                    step={1}
                    defaultValue={Math.max(0, l.cantidadPedida - l.cantidadRecibida) || ""}
                    className="zx-control"
                    aria-label={`Llegó ahora de ${l.codigo}`}
                  />
                </CeldaTabla>
              </FilaTabla>
            ))}
          </Tabla>
          <Tarjeta>
            <div className={styles.filaForm}>
              <Campo etiqueta="Bodega donde llegó">
                <select name="bodegaId" required className="zx-control" defaultValue={orden.bodegaDestinoId}>
                  {bodegasActivas.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.nombre}
                    </option>
                  ))}
                </select>
              </Campo>
              <Campo etiqueta="Nota (opcional)">
                <input name="nota" maxLength={200} placeholder="Factura, guía…" className="zx-control" />
              </Campo>
              <Boton type="submit">Registrar recepción</Boton>
            </div>
          </Tarjeta>
        </form>
      ) : (
        <Tabla encabezados={["SKU", "Pedido", "Recibido", "Costo unit."]}>
          {orden.lineas.map((l) => (
            <FilaTabla key={l.id}>
              <CeldaTabla>
                <strong>{l.codigo}</strong>
                <div className={styles.detalle}>{l.nombre}</div>
              </CeldaTabla>
              <CeldaTabla className={styles.numero}>{l.cantidadPedida}</CeldaTabla>
              <CeldaTabla className={styles.numero}>{l.cantidadRecibida}</CeldaTabla>
              <CeldaTabla className={styles.numero}>{mostrarMonto(l.costoUnitario)}</CeldaTabla>
            </FilaTabla>
          ))}
        </Tabla>
      )}

      <div className={styles.filaForm} style={{ marginTop: 16 }}>
        <BotonLink href="/panel/inventario/compras" variante="fantasma" chico>
          Volver a órdenes
        </BotonLink>
        {puedeAnular && (
          <form action={anularOrdenCompraAction}>
            <input type="hidden" name="ordenCompraId" value={orden.id} />
            <Boton type="submit" variante="secundario" chico>
              Anular orden
            </Boton>
          </form>
        )}
      </div>
    </>
  );
}
