import Link from "next/link";
import { requierePermiso, SinPermisoError } from "@/lib/permisos";
import { obtenerContextoPanel } from "@/lib/panel-contexto";
import { tienePermiso } from "@/lib/roles";
import { listarBodegas } from "@/lib/inventario/bodegas";
import { listarOrdenesCompra } from "@/lib/inventario/compras";
import { listarSkusConStock } from "@/lib/inventario/stock";
import { listarTerceros } from "@/lib/terceros";
import { crearOrdenCompraAction } from "./actions";
import { Boton } from "@/components/marco/Boton";
import { Campo } from "@/components/marco/Campo";
import { Chip } from "@/components/marco/Chip";
import { ESTADO_OC } from "@/components/inventario/estados";
import { EncabezadoPagina } from "@/components/marco/EncabezadoPagina";
import { EstadoVacio } from "@/components/marco/EstadoVacio";
import { SinAcceso } from "@/components/marco/SinAcceso";
import { CeldaTabla, FilaTabla, Tabla } from "@/components/marco/Tabla";
import { Tarjeta } from "@/components/marco/Tarjeta";
import { AvisosUrl, SeccionesInventario } from "@/components/inventario/Avisos";
import styles from "../inventario.module.css";

const FILAS = 8;

// Issue #280 — órdenes de compra simples. Ver pide
// inventario.consultar; crear, inventario.crear (también en la acción).
// La OC sola no mueve stock: lo mueve la recepción.
export default async function ComprasPage({ searchParams }: { searchParams: Record<string, string | string[] | undefined> }) {
  const { usuario, activa, permisos, rolNombre } = await obtenerContextoPanel();
  try {
    await requierePermiso(usuario.id, activa.id, "inventario", "consultar");
  } catch (error) {
    if (!(error instanceof SinPermisoError)) throw error;
    return <SinAcceso mensaje={`Tu rol (${rolNombre}) no tiene acceso a esta pantalla.`} />;
  }
  const puedeCrear = tienePermiso(permisos, "inventario", "crear");
  // Los proveedores son de finanzas: si el rol no puede verlos, la OC
  // se crea sin proveedor (el campo es opcional).
  const veProveedores = tienePermiso(permisos, "finanzas", "consultar");
  const [ordenes, lista, skusSimples, proveedores] = await Promise.all([
    listarOrdenesCompra(activa.id),
    listarBodegas(activa.id, { soloActivas: true }),
    puedeCrear ? listarSkusConStock(activa.id) : Promise.resolve([]),
    puedeCrear && veProveedores ? listarTerceros(activa.id) : Promise.resolve([]),
  ]);

  return (
    <>
      <EncabezadoPagina titulo="Órdenes de compra" descripcion="Lo que le pediste a un proveedor. Al recibir, el stock sube y la orden se cierra sola." />
      <SeccionesInventario actual="/panel/inventario/compras" />
      <AvisosUrl searchParams={searchParams} />

      {puedeCrear && lista.length > 0 && skusSimples.length > 0 && (
        <Tarjeta>
          <h2 className={styles.tituloSeccion}>Nueva orden</h2>
          <form action={crearOrdenCompraAction} className={styles.form}>
            <div className={styles.filaForm}>
              <Campo etiqueta="Bodega de destino">
                <select name="bodegaDestinoId" required className="zx-control" defaultValue={lista.find((b) => b.esPrincipal)?.id ?? lista[0].id}>
                  {lista.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.nombre}
                    </option>
                  ))}
                </select>
              </Campo>
              {proveedores.length > 0 && (
                <Campo etiqueta="Proveedor (opcional)">
                  <select name="terceroId" className="zx-control" defaultValue="">
                    <option value="">Sin proveedor</option>
                    {proveedores.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.nombre}
                      </option>
                    ))}
                  </select>
                </Campo>
              )}
              <Campo etiqueta="Nota (opcional)">
                <input name="nota" maxLength={200} className="zx-control" />
              </Campo>
            </div>
            <div className={styles.lineasOc}>
              {Array.from({ length: FILAS }, (_, i) => (
                <div key={i} className={styles.filaForm}>
                  <select name={`sku_${i}`} className="zx-control" defaultValue="" aria-label={`SKU línea ${i + 1}`}>
                    <option value="">—</option>
                    {skusSimples.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.codigo} — {s.nombre}
                      </option>
                    ))}
                  </select>
                  <input name={`cantidad_${i}`} type="number" min={1} step={1} placeholder="Cantidad" className="zx-control" aria-label={`Cantidad línea ${i + 1}`} />
                  <input name={`costo_${i}`} inputMode="decimal" placeholder="Costo unitario (opcional)" className="zx-control" aria-label={`Costo línea ${i + 1}`} />
                </div>
              ))}
            </div>
            <Boton type="submit" className={styles.botonCrear}>
              Crear orden
            </Boton>
          </form>
        </Tarjeta>
      )}

      <div style={{ height: 16 }} />

      {ordenes.length === 0 ? (
        <EstadoVacio>Todavía no hay órdenes de compra.</EstadoVacio>
      ) : (
        <Tabla encabezados={["Orden", "Proveedor", "Bodega", "SKU", "Estado", "Creada"]}>
          {ordenes.map((o) => (
            <FilaTabla key={o.id}>
              <CeldaTabla>
                <Link href={`/panel/inventario/compras/${o.id}`} className={styles.enlaceAviso}>
                  OC-{o.numero}
                </Link>
              </CeldaTabla>
              <CeldaTabla>{o.proveedor ?? "—"}</CeldaTabla>
              <CeldaTabla>{o.bodega}</CeldaTabla>
              <CeldaTabla className={styles.numero}>{o.lineas}</CeldaTabla>
              <CeldaTabla>
                <Chip estado={ESTADO_OC[o.estado]?.estado ?? "neutro"}>{ESTADO_OC[o.estado]?.texto ?? o.estado}</Chip>
              </CeldaTabla>
              <CeldaTabla>{o.creadoTs.toLocaleDateString("es-CO", { timeZone: "America/Bogota" })}</CeldaTabla>
            </FilaTabla>
          ))}
        </Tabla>
      )}
    </>
  );
}
