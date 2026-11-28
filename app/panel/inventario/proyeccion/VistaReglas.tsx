import { Boton } from "@/components/marco/Boton";
import { Campo } from "@/components/marco/Campo";
import { CeldaTabla, FilaTabla, Tabla } from "@/components/marco/Tabla";
import { Tarjeta } from "@/components/marco/Tarjeta";
import { ETIQUETA_RUTA, RUTAS_COMPRA, VENTANAS_DIAS, type ReglasProyeccion, type ResultadoProyeccion } from "@/lib/inventario/proyeccion";
import { guardarEntregaSkuAction, guardarReglasProyeccionAction } from "./actions";
import styles from "./proyeccion.module.css";

// Reglas de la empresa y días de entrega por producto: todo editable,
// cada negocio compra distinto (nacional, plataforma, avión).
export function VistaReglas({ reglas, filas, puedeEditar }: { reglas: ReglasProyeccion; filas: ResultadoProyeccion[]; puedeEditar: boolean }) {
  return (
    <>
      <div className={styles.gridReglas}>
        <Tarjeta>
          <h2 className={styles.tituloSeccion}>Reglas de la proyección</h2>
          <form action={guardarReglasProyeccionAction} className={styles.formulario}>
            <fieldset disabled={!puedeEditar} style={{ border: 0, padding: 0, margin: 0, display: "contents" }}>
              <div className={styles.filaCampos}>
                <Campo etiqueta="Días que quiero cubrir">
                  <input name="coberturaDias" type="number" min={1} max={365} step={1} required defaultValue={reglas.coberturaDias} className="zx-control" />
                </Campo>
                <Campo etiqueta="Colchón de seguridad (%)">
                  <input name="colchonPorcentaje" type="number" min={0} max={200} step={1} required defaultValue={reglas.colchonPorcentaje} className="zx-control" />
                </Campo>
                <Campo etiqueta="Vendo por día según">
                  <select name="ventanaDias" defaultValue={reglas.ventanaDias} className="zx-control">
                    {VENTANAS_DIAS.map((d) => (
                      <option key={d} value={d}>
                        Últimos {d} días
                      </option>
                    ))}
                  </select>
                </Campo>
              </div>
              <p className={styles.nota}>Cuánto tarda en llegarte la mercadería según cómo compras (en días):</p>
              <div className={styles.filaCampos}>
                <Campo etiqueta={ETIQUETA_RUTA.nacional}>
                  <input name="leadNacional" type="number" min={0} max={365} step={1} required defaultValue={reglas.leadPorRuta.nacional} className="zx-control" />
                </Campo>
                <Campo etiqueta={ETIQUETA_RUTA.plataforma}>
                  <input name="leadPlataforma" type="number" min={0} max={365} step={1} required defaultValue={reglas.leadPorRuta.plataforma} className="zx-control" />
                </Campo>
                <Campo etiqueta={ETIQUETA_RUTA.avion}>
                  <input name="leadAvion" type="number" min={0} max={365} step={1} required defaultValue={reglas.leadPorRuta.avion} className="zx-control" />
                </Campo>
              </div>
              {puedeEditar && <Boton type="submit">Guardar reglas</Boton>}
            </fieldset>
          </form>
        </Tarjeta>
        <Tarjeta>
          <h2 className={styles.tituloSeccion}>Cómo se calcula</h2>
          <p className={styles.nota}>
            <strong>Cuánto me dura</strong> = stock ÷ lo que vendes por día. <strong>Comprar ya</strong> = dura menos de lo que tarda en llegar un pedido.{" "}
            <strong>Cuánto pedir</strong> = ventas por día × (días de entrega + días a cubrir) × colchón − lo que ya hay. El stock que cuenta es el de tus
            bodegas propias; Full no se suma.
          </p>
        </Tarjeta>
      </div>

      <div className={styles.seccion}>
        <h2 className={styles.tituloSeccion}>Entrega por producto</h2>
        <p className={styles.nota}>Elige cómo compras cada producto. Si pones días propios, mandan sobre los de la forma de compra; vacío usa los de arriba.</p>
        <Tabla encabezados={["Producto", "Cómo lo compro", "Días propios", ""]}>
          {filas.map((f) => (
            <FilaTabla key={f.skuId}>
              <CeldaTabla>
                <div className={styles.producto}>
                  <strong>{f.nombre}</strong>
                  <span className={styles.codigo}>{f.codigo} · hoy llega en {f.leadTimeDias} d</span>
                </div>
              </CeldaTabla>
              <CeldaTabla colSpan={3}>
                <form action={guardarEntregaSkuAction} className={styles.formEntrega}>
                  <input type="hidden" name="skuId" value={f.skuId} />
                  <input type="hidden" name="vuelta" value="reglas" />
                  <select name="ruta" defaultValue={f.ruta} aria-label={`Cómo compras ${f.codigo}`} className="zx-control" disabled={!puedeEditar}>
                    {RUTAS_COMPRA.map((r) => (
                      <option key={r} value={r}>
                        {ETIQUETA_RUTA[r]}
                      </option>
                    ))}
                  </select>
                  <input
                    name="leadTimeDias"
                    type="number"
                    min={0}
                    max={365}
                    step={1}
                    placeholder="Los de la forma"
                    aria-label={`Días propios de ${f.codigo}`}
                    defaultValue={reglasPropias(f, reglas)}
                    className={`zx-control ${styles.campoChico}`}
                    disabled={!puedeEditar}
                  />
                  {puedeEditar && (
                    <Boton type="submit" variante="secundario" chico>
                      Guardar
                    </Boton>
                  )}
                </form>
              </CeldaTabla>
            </FilaTabla>
          ))}
        </Tabla>
      </div>
    </>
  );
}

// Solo se rellena el campo si el SKU tiene días propios (distintos del
// de su forma de compra); si no, queda vacío y sigue a la regla.
function reglasPropias(f: ResultadoProyeccion, reglas: ReglasProyeccion): number | undefined {
  return f.leadTimeDias === reglas.leadPorRuta[f.ruta] ? undefined : f.leadTimeDias;
}
