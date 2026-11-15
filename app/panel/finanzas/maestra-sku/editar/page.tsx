import { obtenerContextoPanel } from "@/lib/panel-contexto";
import { leerCostoSku, normalizarSkuCodigo } from "@/lib/costos-sku";
import { normalizarParametro } from "@/lib/filtros-listado";
import { listarProveedoresParaFiltro } from "@/lib/finanzas/maestra";
import { mostrarMonto } from "@/lib/finanzas/montos";
import { requierePermiso, SinPermisoError } from "@/lib/permisos";
import { guardarFilaMaestraAction } from "../actions";
import { Boton, BotonLink } from "@/components/marco/Boton";
import { Campo } from "@/components/marco/Campo";
import { EncabezadoPagina } from "@/components/marco/EncabezadoPagina";
import { SinAcceso } from "@/components/marco/SinAcceso";
import { Tarjeta } from "@/components/marco/Tarjeta";
import styles from "../../finanzas.module.css";

// Issue #128 — editar (o crear) una fila de la tabla maestra. ?sku=
// solo sirve para buscar la fila de ESTA empresa; un SKU que no está
// abre el formulario de SKU nuevo.
export default async function EditarMaestraPage({ searchParams }: { searchParams: Record<string, string | string[] | undefined> }) {
  const { usuario, activa: empresa, rolNombre } = await obtenerContextoPanel();
  try {
    await requierePermiso(usuario.id, empresa.id, "finanzas", "modificar");
  } catch (error) {
    if (!(error instanceof SinPermisoError)) throw error;
    return <SinAcceso mensaje={`Tu rol (${rolNombre}) no puede editar la tabla maestra.`} volverHref="/panel/finanzas/maestra-sku" volverTexto="Volver" />;
  }

  const skuParametro = normalizarParametro(searchParams.sku)?.trim();
  const fila = skuParametro ? await leerCostoSku(empresa.id, normalizarSkuCodigo(skuParametro)) : null;
  const proveedores = await listarProveedoresParaFiltro(empresa.id);
  const error = normalizarParametro(searchParams.error);
  const esNueva = !fila;

  return (
    <>
      <EncabezadoPagina titulo={fila ? `Editar ${fila.skuCodigo}` : "Nuevo SKU en la tabla maestra"} />
      {error && <p className={styles.avisoError}>{error}</p>}
      <Tarjeta>
        <form action={guardarFilaMaestraAction} className={styles.form}>
          {esNueva && <input type="hidden" name="nueva" value="1" />}
          <div className={styles.grilla}>
            <Campo etiqueta="SKU">
              {fila ? (
                <>
                  <input type="hidden" name="sku" value={fila.skuCodigo} />
                  <strong>{fila.skuCodigo}</strong>
                </>
              ) : (
                <input name="sku" required maxLength={120} className="zx-control" />
              )}
            </Campo>
            <Campo etiqueta="Producto">
              <input name="nombreProducto" maxLength={300} defaultValue={fila?.nombreProducto ?? ""} className="zx-control" />
            </Campo>
            <Campo etiqueta="Proveedor">
              <select name="terceroId" defaultValue={fila?.terceroId ?? ""} className="zx-control">
                <option value="">Sin proveedor</option>
                {proveedores
                  .filter((p) => p.activo || p.id === fila?.terceroId)
                  .map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.nombre}
                      {p.empaque === null ? "" : ` (packing ${mostrarMonto(p.empaque)})`}
                    </option>
                  ))}
              </select>
            </Campo>
            <Campo etiqueta="Costo (vacío = sin costo; 0 = costo real de $0)">
              <input name="costo" inputMode="decimal" defaultValue={fila?.costo ?? ""} className="zx-control" />
            </Campo>
            <Campo etiqueta="Packing propio (vacío = usa el del proveedor)">
              <input name="empaque" inputMode="decimal" defaultValue={fila?.empaque ?? ""} className="zx-control" />
            </Campo>
            <Campo etiqueta="Envío agencia (0 = $0 real)">
              <input name="envioAgencia" inputMode="decimal" defaultValue={fila?.envioAgencia ?? ""} className="zx-control" />
            </Campo>
            <Campo etiqueta="Precio mínimo x1 (0 = no aplica)">
              <input name="precioMinimoUnidad" inputMode="decimal" defaultValue={fila?.precioMinimoUnidad ?? ""} className="zx-control" />
            </Campo>
            <Campo etiqueta="Precio mínimo combo x2 (0 = no aplica)">
              <input name="precioMinimoComboX2" inputMode="decimal" defaultValue={fila?.precioMinimoComboX2 ?? ""} className="zx-control" />
            </Campo>
            <Campo etiqueta="Precio mínimo combo x3 (0 = no aplica)">
              <input name="precioMinimoComboX3" inputMode="decimal" defaultValue={fila?.precioMinimoComboX3 ?? ""} className="zx-control" />
            </Campo>
            <Campo etiqueta="Precio de venta (opcional)">
              <input name="precioVenta" inputMode="decimal" defaultValue={fila?.precioVenta ?? ""} className="zx-control" />
            </Campo>
          </div>
          <p className={styles.ayuda}>
            Montos con punto de miles y coma decimal (2.000 o 1.234,56). Un cambio aplica a las ventas nuevas: las ya congeladas no cambian.
          </p>
          <div className={styles.acciones}>
            <Boton type="submit">Guardar</Boton>
          </div>
        </form>
      </Tarjeta>
      <BotonLink href="/panel/finanzas/maestra-sku" variante="fantasma" chico className={styles.volver}>
        Volver a la tabla maestra
      </BotonLink>
    </>
  );
}
