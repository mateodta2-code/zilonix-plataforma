import { randomUUID } from "crypto";
import { Boton } from "@/components/marco/Boton";
import { EstadoVacio } from "@/components/marco/EstadoVacio";
import { CeldaTabla, FilaTabla, Tabla } from "@/components/marco/Tabla";
import { Tarjeta } from "@/components/marco/Tarjeta";
import { ETIQUETA_RUTA, RUTAS_COMPRA, ordenarPorUrgencia, type ReglasProyeccion, type ResultadoProyeccion } from "@/lib/inventario/proyeccion";
import { crearOrdenDesdePlanAction } from "./actions";
import { ChipEstado, formatoDias, formatoUnidadesPorDia } from "./formato";
import styles from "./proyeccion.module.css";

// Propuesta B — plan de compra: lo que el sistema sugiere pedir,
// agrupado por cómo se compra (cada forma tarda distinto). Las
// cantidades se ajustan antes de crear la orden de compra.
export function VistaPlan({ filas, reglas, puedeCrear }: { filas: ResultadoProyeccion[]; reglas: ReglasProyeccion; puedeCrear: boolean }) {
  const aComprar = ordenarPorUrgencia(filas).filter((f) => f.cantidadSugerida > 0 && (f.estado === "comprar_ya" || f.estado === "pronto"));
  if (aComprar.length === 0) {
    return <EstadoVacio>Por ahora no hace falta comprar nada: ningún producto se acaba antes de {reglas.leadPorRuta.nacional}+ días de margen.</EstadoVacio>;
  }
  const grupos = RUTAS_COMPRA.map((ruta) => ({ ruta, items: aComprar.filter((f) => f.ruta === ruta) })).filter((g) => g.items.length > 0);
  return (
    <>
      <p className={styles.nota}>
        Se sugiere lo necesario para vender durante la entrega más {reglas.coberturaDias} días, con {reglas.colchonPorcentaje}% de colchón, menos lo que ya
        hay. Cambia las cantidades si quieres: una en 0 no entra a la orden.
      </p>
      {grupos.map(({ ruta, items }) => (
        <div key={ruta} className={`${styles.grupoPlan} ${styles.seccion}`}>
          <Tarjeta>
            <form action={crearOrdenDesdePlanAction}>
              <input type="hidden" name="ruta" value={ruta} />
              <input type="hidden" name="operacionId" value={randomUUID()} />
              <div className={styles.cabeceraGrupo}>
                <h2 className={styles.tituloSeccion}>{ETIQUETA_RUTA[ruta]}</h2>
                <span className={styles.codigo}>{items.reduce((s, f) => s + f.cantidadSugerida, 0)} unidades sugeridas · {items.length} producto(s)</span>
              </div>
              <Tabla encabezados={["Producto", "Por qué", { clave: "cant", contenido: "Pedir", numerica: true }, "Estado"]}>
                {items.map((f, i) => (
                  <FilaTabla key={f.skuId}>
                    <CeldaTabla>
                      <input type="hidden" name={`sku_${i}`} value={f.skuId} />
                      <div className={styles.producto}>
                        <strong>{f.nombre}</strong>
                        <span className={styles.codigo}>
                          {f.codigo} · stock {f.stock} u · dura {formatoDias(f.diasCobertura)}
                        </span>
                      </div>
                    </CeldaTabla>
                    <CeldaTabla>
                      <span className={styles.razon}>
                        Vendes {formatoUnidadesPorDia(f.velocidad)} u/día y el pedido tarda {f.leadTimeDias} d en llegar.
                      </span>
                    </CeldaTabla>
                    <CeldaTabla numerica>
                      <input
                        name={`cantidad_${i}`}
                        type="number"
                        min={0}
                        step={1}
                        defaultValue={f.cantidadSugerida}
                        aria-label={`Cantidad a pedir de ${f.codigo}`}
                        className={`zx-control ${styles.campoCantidad}`}
                        disabled={!puedeCrear}
                      />
                    </CeldaTabla>
                    <CeldaTabla>
                      <ChipEstado estado={f.estado} />
                    </CeldaTabla>
                  </FilaTabla>
                ))}
              </Tabla>
              <div className={styles.pieGrupo}>
                <span className={styles.nota}>Crea una orden de compra abierta hacia tu bodega principal; se recibe desde Registro de compras.</span>
                {puedeCrear && <Boton type="submit">Crear orden de compra</Boton>}
              </div>
            </form>
          </Tarjeta>
        </div>
      ))}
    </>
  );
}
