import { randomUUID } from "crypto";
import { notFound } from "next/navigation";
import { requierePermiso, SinPermisoError } from "@/lib/permisos";
import { obtenerContextoPanel } from "@/lib/panel-contexto";
import { tienePermiso } from "@/lib/roles";
import { listarBodegas } from "@/lib/inventario/bodegas";
import { obtenerOrdenCompra } from "@/lib/inventario/compras";
import { mostrarMonto } from "@/lib/finanzas/montos";
import { actualizarDatosCompraAction, actualizarLineasCompraAction, anularOrdenCompraAction, marcarLiquidadoAction, recibirOrdenCompraAction } from "../actions";
import { fechaCorta, hoyBogota, PLATAFORMAS_COMPRA } from "@/lib/inventario/registro-compras";
import { Boton, BotonLink } from "@/components/marco/Boton";
import { Campo } from "@/components/marco/Campo";
import { Chip } from "@/components/marco/Chip";
import { EncabezadoPagina } from "@/components/marco/EncabezadoPagina";
import { SinAcceso } from "@/components/marco/SinAcceso";
import { CeldaTabla, FilaTabla, Tabla } from "@/components/marco/Tabla";
import { Tarjeta } from "@/components/marco/Tarjeta";
import { AvisosUrl } from "@/components/inventario/Avisos";
import { ESTADO_OC } from "@/components/inventario/estados";
import styles from "../../inventario.module.css";
import { SkuCopiable } from "@/components/marco/SkuCopiable";

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
  // Registro de compras (27-nov): datos de la compra en la plataforma
  // (inventario.crear) y «Liquidado» (finanzas.modificar, igual que en
  // Finanzas → Por pagar). También se revisa adentro de cada acción.
  const puedeEditarCompra = tienePermiso(permisos, "inventario", "crear");
  const puedeLiquidar = !orden.fechaPago && orden.estado !== "anulada" && tienePermiso(permisos, "finanzas", "modificar");
  const hoy = hoyBogota(new Date());
  const puedeCorregirCantidad = orden.estado === "abierta";
  const puedeCorregirValor = orden.estado !== "anulada" && !orden.fechaPago;

  return (
    <>
      <EncabezadoPagina
        titulo={`OC-${orden.numero}`}
        descripcion={`${orden.proveedor ?? "Sin proveedor"} · llega a ${orden.bodega}${orden.nota ? ` · ${orden.nota}` : ""}`}
        accion={<Chip estado={ESTADO_OC[orden.estado]?.estado ?? "neutro"}>{ESTADO_OC[orden.estado]?.texto ?? orden.estado}</Chip>}
      />
      <AvisosUrl searchParams={searchParams} />

      {puedeRecibir ? (
        <form action={recibirOrdenCompraAction} className={styles.form}>
          <input type="hidden" name="recepcionId" value={randomUUID()} />
          <input type="hidden" name="ordenCompraId" value={orden.id} />
          <Tabla encabezados={["SKU", "Pedido", "Recibido", "Pendiente", "Costo unit.", "Llegó ahora"]}>
            {orden.lineas.map((l, i) => (
              <FilaTabla key={l.id}>
                <CeldaTabla>
                  <strong><SkuCopiable sku={l.codigo} /></strong>
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
                <strong><SkuCopiable sku={l.codigo} /></strong>
                <div className={styles.detalle}>{l.nombre}</div>
              </CeldaTabla>
              <CeldaTabla className={styles.numero}>{l.cantidadPedida}</CeldaTabla>
              <CeldaTabla className={styles.numero}>{l.cantidadRecibida}</CeldaTabla>
              <CeldaTabla className={styles.numero}>{mostrarMonto(l.costoUnitario)}</CeldaTabla>
            </FilaTabla>
          ))}
        </Tabla>
      )}

      <div style={{ height: 16 }} />
      <Tarjeta>
        <h2 className={styles.tituloSeccion}>Datos de la compra</h2>
        {puedeEditarCompra ? (
          <form action={actualizarDatosCompraAction} className={styles.form}>
            <input type="hidden" name="ordenCompraId" value={orden.id} />
            <div className={styles.filaForm}>
              <Campo etiqueta="Fecha de compra">
                <input type="date" name="fechaCompra" defaultValue={orden.fechaCompra ?? ""} className="zx-control" />
              </Campo>
              <Campo etiqueta="Forma de pago">
                <input name="formaPago" defaultValue={orden.formaPago ?? ""} maxLength={60} className="zx-control" />
              </Campo>
              <Campo etiqueta="Plataforma">
                <input name="plataforma" list="plataformas-oc" defaultValue={orden.plataforma ?? ""} maxLength={40} className="zx-control" />
                <datalist id="plataformas-oc">
                  {PLATAFORMAS_COMPRA.map((p) => (
                    <option key={p} value={p} />
                  ))}
                </datalist>
              </Campo>
            </div>
            <div className={styles.filaForm}>
              <Campo etiqueta="Orden de compra (de la plataforma)">
                <input name="ordenPlataforma" defaultValue={orden.ordenPlataforma ?? ""} maxLength={80} className="zx-control" />
              </Campo>
              <Campo etiqueta="Link de compra">
                <input name="linkCompra" type="url" defaultValue={orden.linkCompra ?? ""} maxLength={500} placeholder="https://…" className="zx-control" />
              </Campo>
              <Campo etiqueta="Entrega estimada">
                <input name="entregaEstimada" type="date" defaultValue={orden.entregaEstimada ?? ""} className="zx-control" />
              </Campo>
              <Boton type="submit">Guardar datos</Boton>
            </div>
          </form>
        ) : (
          <p className={styles.detalle}>
            {fechaCorta(orden.fechaCompra)} · {orden.plataforma ?? "sin plataforma"} · {orden.formaPago ?? "sin forma de pago"}
            {orden.ordenPlataforma ? ` · orden ${orden.ordenPlataforma}` : ""} · entrega estimada {fechaCorta(orden.entregaEstimada)}
          </p>
        )}
        {/* 27-nov: corregir cantidad y valor unidad. Cantidad solo si no ha
            llegado nada; valor solo si no está liquidada (también se revisa
            en actualizarLineasCompra). */}
        {puedeEditarCompra && (puedeCorregirCantidad || puedeCorregirValor) && (
          <form action={actualizarLineasCompraAction} className={styles.form} style={{ marginTop: 12 }}>
            <input type="hidden" name="ordenCompraId" value={orden.id} />
            {orden.lineas.map((l, i) => (
              <div key={l.id} className={styles.filaForm}>
                <input type="hidden" name={`item_${i}`} value={l.id} />
                <Campo etiqueta={orden.lineas.length > 1 ? `Cantidad · ${l.codigo}` : "Cantidad"}>
                  <input
                    name={`cantidad_${i}`}
                    type="number"
                    min={1}
                    step={1}
                    defaultValue={l.cantidadPedida}
                    readOnly={!puedeCorregirCantidad}
                    title={puedeCorregirCantidad ? undefined : "Ya llegó mercancía: la cantidad no se corrige."}
                    className="zx-control"
                  />
                </Campo>
                <Campo etiqueta={orden.lineas.length > 1 ? `Valor unidad · ${l.codigo}` : "Valor unidad"}>
                  <input
                    name={`valor_${i}`}
                    inputMode="decimal"
                    defaultValue={l.costoUnitario ?? ""}
                    readOnly={!puedeCorregirValor}
                    title={puedeCorregirValor ? undefined : "La compra ya está liquidada: el valor no se corrige."}
                    className="zx-control"
                  />
                </Campo>
                {i === orden.lineas.length - 1 && <Boton type="submit">Guardar cantidad y valor</Boton>}
              </div>
            ))}
            <p className={styles.detalle}>
              {puedeCorregirCantidad ? "La cantidad se corrige mientras no llegue nada." : "Ya llegó mercancía: la cantidad quedó fija."}{" "}
              {puedeCorregirValor ? "El valor se corrige mientras no esté liquidada." : "Ya está liquidada: el valor quedó fijo."}
            </p>
          </form>
        )}
        {orden.linkCompra && (
          <p className={styles.detalle}>
            <a href={orden.linkCompra} target="_blank" rel="noopener noreferrer" className={styles.enlaceAviso}>
              Abrir el link de compra
            </a>
          </p>
        )}

        <h2 className={styles.tituloSeccion} style={{ marginTop: 16 }}>
          Liquidado
        </h2>
        {orden.fechaPago ? (
          <p className={styles.detalle}>
            Liquidado el {fechaCorta(orden.fechaPago)}
            {orden.medioPago ? ` · ${orden.medioPago}` : ""}.
          </p>
        ) : puedeLiquidar ? (
          <form action={marcarLiquidadoAction} className={styles.filaForm}>
            <input type="hidden" name="ordenCompraId" value={orden.id} />
            <Campo etiqueta="Fecha en que se liquidó">
              <input type="date" name="fechaPago" defaultValue={hoy} required className="zx-control" />
            </Campo>
            <Campo etiqueta="Medio">
              <input name="medioPago" defaultValue={orden.formaPago ?? ""} maxLength={60} className="zx-control" />
            </Campo>
            <Boton type="submit">Marcar liquidado</Boton>
          </form>
        ) : (
          <p className={styles.detalle}>Pendiente de liquidar.</p>
        )}
      </Tarjeta>

      <div className={styles.filaForm} style={{ marginTop: 16 }}>
        <BotonLink href="/panel/inventario/compras" variante="fantasma">
          Volver al registro
        </BotonLink>
        {puedeAnular && (
          <form action={anularOrdenCompraAction}>
            <input type="hidden" name="ordenCompraId" value={orden.id} />
            <Boton type="submit" variante="peligro">
              Anular orden
            </Boton>
          </form>
        )}
      </div>
    </>
  );
}
