import { Chip } from "@/components/marco/Chip";
import { EstadoVacio } from "@/components/marco/EstadoVacio";
import { RejillaKpi } from "@/components/marco/RejillaKpi";
import { CeldaTabla, FilaTabla, Tabla } from "@/components/marco/Tabla";
import { TarjetaKpi } from "@/components/marco/TarjetaKpi";
import { ETIQUETA_RUTA, contarPorEstado, ordenarPorUrgencia, type ReglasProyeccion, type ResultadoProyeccion } from "@/lib/inventario/proyeccion";
import { BarraCobertura, ChipEstado, Tendencia, formatoDias, formatoFecha, formatoUnidadesPorDia } from "./formato";
import styles from "./proyeccion.module.css";

// Propuesta A — "¿qué tengo que comprar hoy?": lo urgente arriba.
export function VistaSemaforo({ filas, reglas }: { filas: ResultadoProyeccion[]; reglas: ReglasProyeccion }) {
  if (filas.length === 0) {
    return <EstadoVacio>Todavía no hay productos con stock o ventas para proyectar. Carga stock en Inventario o espera a que entren pedidos.</EstadoVacio>;
  }
  const conteo = contarPorEstado(filas);
  const ordenadas = ordenarPorUrgencia(filas);
  return (
    <>
      <RejillaKpi>
        <TarjetaKpi titulo="Comprar ya" valor={conteo.comprar_ya} detalle={["Se acaban antes de que llegue un pedido"]} />
        <TarjetaKpi titulo="Pronto" valor={conteo.pronto} detalle={["Menos de 10 días de margen"]} />
        <TarjetaKpi titulo="Saludable" valor={conteo.saludable} detalle={["Cobertura suficiente"]} />
        <TarjetaKpi titulo="Sobrestock" valor={conteo.sobrestock} detalle={["Más de 90 días de inventario"]} />
      </RejillaKpi>

      <div className={styles.seccion}>
        <h2 className={styles.tituloSeccion}>Productos por urgencia</h2>
        <Tabla
          encabezados={[
            "Producto",
            { clave: "stock", contenido: "Stock", numerica: true },
            { clave: "vende", contenido: "Venta por día", numerica: true },
            "Cuánto me dura",
            "Se agota el",
            { clave: "comprar", contenido: "Comprar", numerica: true },
            "Estado",
          ]}
        >
          {ordenadas.map((f) => (
            <FilaTabla key={f.skuId}>
              <CeldaTabla>
                <div className={styles.producto}>
                  <strong>{f.nombre}</strong>
                  <span className={styles.codigo}>
                    {f.codigo} · {ETIQUETA_RUTA[f.ruta]}, llega en {f.leadTimeDias} d
                  </span>
                </div>
              </CeldaTabla>
              <CeldaTabla numerica>{f.stock}</CeldaTabla>
              <CeldaTabla numerica>
                <div>{formatoUnidadesPorDia(f.velocidad)}</div>
                <Tendencia porcentaje={f.tendenciaPorcentaje} />
              </CeldaTabla>
              <CeldaTabla>
                <div className={styles.diasTexto}>{formatoDias(f.diasCobertura)}</div>
                {f.diasCobertura !== null && <BarraCobertura fila={f} />}
              </CeldaTabla>
              <CeldaTabla>{formatoFecha(f.fechaAgotamiento)}</CeldaTabla>
              <CeldaTabla numerica>{f.cantidadSugerida > 0 ? `${f.cantidadSugerida} u` : "—"}</CeldaTabla>
              <CeldaTabla>
                <ChipEstado estado={f.estado} />
              </CeldaTabla>
            </FilaTabla>
          ))}
        </Tabla>
        <p className={styles.nota}>
          La raya en la barra marca cuándo llega un pedido hecho hoy: si el color no la pasa, ya vas tarde. Para sugerir cuánto comprar se cubren{" "}
          {reglas.coberturaDias} días después de que llegue, con {reglas.colchonPorcentaje}% de colchón (se cambian en Reglas y entregas).{" "}
          <Chip estado="neutro">Solo bodegas propias</Chip>
        </p>
      </div>
    </>
  );
}
