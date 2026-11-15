import { requierePermiso, SinPermisoError } from "@/lib/permisos";
import { obtenerContextoPanel } from "@/lib/panel-contexto";
import { tienePermiso } from "@/lib/roles";
import { leerConfiguracionInventario, REGLAS_ULTIMA_UNIDAD } from "@/lib/inventario/configuracion";
import { guardarConfiguracionInventarioAction, sincronizarStockAhoraAction } from "./actions";
import { Boton } from "@/components/marco/Boton";
import { Campo } from "@/components/marco/Campo";
import { EncabezadoPagina } from "@/components/marco/EncabezadoPagina";
import { SinAcceso } from "@/components/marco/SinAcceso";
import { Tarjeta } from "@/components/marco/Tarjeta";
import { AvisosUrl, SeccionesInventario } from "@/components/inventario/Avisos";
import styles from "../inventario.module.css";

// Issue #280 — configuración de inventario de la empresa. Ver pide
// inventario.consultar; cambiar y "Sincronizar ahora",
// inventario.autorizar (también en cada acción): prenden escrituras
// reales en Mercado Libre y reservas de pedidos reales.
export default async function ConfiguracionInventarioPage({ searchParams }: { searchParams: Record<string, string | string[] | undefined> }) {
  const { usuario, activa, permisos, rolNombre } = await obtenerContextoPanel();
  try {
    await requierePermiso(usuario.id, activa.id, "inventario", "consultar");
  } catch (error) {
    if (!(error instanceof SinPermisoError)) throw error;
    return <SinAcceso mensaje={`Tu rol (${rolNombre}) no tiene acceso a esta pantalla.`} />;
  }
  const puedeCambiar = tienePermiso(permisos, "inventario", "autorizar");
  const config = await leerConfiguracionInventario(activa.id);

  return (
    <>
      <EncabezadoPagina titulo="Configuración de inventario" descripcion="Cómo se conecta el stock de Seller con Mercado Libre." />
      <SeccionesInventario actual="/panel/inventario/configuracion" />
      <AvisosUrl searchParams={searchParams} />

      <Tarjeta>
        <form action={guardarConfiguracionInventarioAction} className={styles.form}>
          <fieldset disabled={!puedeCambiar} style={{ border: 0, padding: 0, margin: 0, display: "contents" }}>
            <label className={styles.check}>
              <input type="checkbox" name="reservarPedidos" defaultChecked={config.reservaPedidosDesdeTs !== null} />
              Reservar stock con los pedidos de Mercado Libre
            </label>
            <p className={styles.detalle}>
              {config.reservaPedidosDesdeTs
                ? `Activo para los pedidos creados desde el ${config.reservaPedidosDesdeTs.toLocaleString("es-CO", { timeZone: "America/Bogota" })}. Los anteriores no tocan el stock.`
                : "Apagado. Al prenderlo, solo los pedidos que entren desde ese momento reservan stock: los ya despachados no se descuentan."}{" "}
              Un pedido pagado reserva, al despacharse confirma y al cancelarse libera. Si no alcanza entero en una sola bodega, no se reserva nada (queda en Actividad). Los pedidos Full no tocan tu stock.
            </p>

            <label className={styles.check}>
              <input type="checkbox" name="syncMlActivo" defaultChecked={config.syncMlActivo} />
              Enviar el disponible a Mercado Libre
            </label>
            <p className={styles.detalle}>
              Actualiza la cantidad de cada publicación enlazada a un SKU. No se envían publicaciones Full ni con variaciones (Fase 1). Prender solo después de
              cargar el stock real: si una bodega está en 0, la publicación queda en 0.
            </p>

            <div className={styles.filaForm}>
              <Campo etiqueta="Colchón (unidades que no se publican)">
                <input name="bufferMl" type="number" min={0} step={1} required defaultValue={config.bufferMl} className="zx-control" />
              </Campo>
              <Campo etiqueta="Umbral de última unidad (0 = apagado)">
                <input name="umbralUltimaUnidad" type="number" min={0} step={1} required defaultValue={config.umbralUltimaUnidad} className="zx-control" />
              </Campo>
              <Campo etiqueta="Cuando llega a la última unidad">
                <select name="reglaUltimaUnidad" defaultValue={config.reglaUltimaUnidad} className="zx-control">
                  {REGLAS_ULTIMA_UNIDAD.map((r) => (
                    <option key={r.valor} value={r.valor}>
                      {r.etiqueta}
                    </option>
                  ))}
                </select>
              </Campo>
            </div>
            <p className={styles.detalle}>
              Por ahora toda regla avisa con un banner en Inventario (Aplicar / No aplicar): quitar promociones se hace a mano en Mercado Libre, porque la
              conexión con su API de promociones todavía no está.
            </p>
            {puedeCambiar && (
              <Boton type="submit" className={styles.botonCrear}>
                Guardar
              </Boton>
            )}
          </fieldset>
        </form>
      </Tarjeta>

      {puedeCambiar && config.syncMlActivo && (
        <form action={sincronizarStockAhoraAction} style={{ marginTop: 16 }}>
          <Boton type="submit" variante="secundario">
            Sincronizar ahora con Mercado Libre
          </Boton>
        </form>
      )}
      {!puedeCambiar && <p className={styles.detalle}>Tu rol puede ver esta configuración, pero no cambiarla.</p>}
    </>
  );
}
