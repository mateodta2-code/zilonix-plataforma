import { EstadoVacio } from "@/components/marco/EstadoVacio";
import { CeldaTabla, FilaTabla, Tabla } from "@/components/marco/Tabla";
import { Tarjeta } from "@/components/marco/Tarjeta";
import { VENTANAS_DIAS, accionSugerida, type ResultadoProyeccion } from "@/lib/inventario/proyeccion";
import { Tendencia, formatoDias, formatoUnidadesPorDia } from "./formato";
import styles from "./proyeccion.module.css";

// Propuesta C — qué rota, qué crece y qué se quedó quieto.
function Destacado({ titulo, fila, detalle }: { titulo: string; fila: ResultadoProyeccion | undefined; detalle: (f: ResultadoProyeccion) => React.ReactNode }) {
  return (
    <Tarjeta>
      <p className="zx-etiqueta">{titulo}</p>
      {fila ? (
        <>
          <p className={styles.destacadoNombre}>{fila.nombre}</p>
          <p className={styles.codigo}>{fila.codigo}</p>
          <p className={styles.nota}>{detalle(fila)}</p>
        </>
      ) : (
        <p className={styles.nota}>Sin datos suficientes todavía.</p>
      )}
    </Tarjeta>
  );
}

export function VistaRotacion({ filas }: { filas: ResultadoProyeccion[] }) {
  if (filas.length === 0) return <EstadoVacio>Todavía no hay ventas ni stock para analizar.</EstadoVacio>;
  const conVentas = filas.filter((f) => f.vendidas30 > 0);
  const masRota = [...conVentas].sort((a, b) => b.velocidadPorVentana[30] - a.velocidadPorVentana[30])[0];
  const masCrece = [...conVentas].filter((f) => (f.tendenciaPorcentaje ?? 0) > 0).sort((a, b) => (b.tendenciaPorcentaje ?? 0) - (a.tendenciaPorcentaje ?? 0))[0];
  const masQuieto = [...filas].filter((f) => f.stock > 0).sort((a, b) => (b.diasCobertura ?? Infinity) - (a.diasCobertura ?? Infinity))[0];
  const maximo = Math.max(...filas.flatMap((f) => VENTANAS_DIAS.map((d) => f.velocidadPorVentana[d])), 0.0001);
  const ordenadas = [...filas].sort((a, b) => b.vendidas30 - a.vendidas30 || a.codigo.localeCompare(b.codigo));
  return (
    <>
      <div className={styles.destacados}>
        <Destacado titulo="El que más rota" fila={masRota} detalle={(f) => `${formatoUnidadesPorDia(f.velocidadPorVentana[30])} u/día en 30 días · ${f.vendidas30} vendidas`} />
        <Destacado
          titulo="El que más crece (7 d vs 30 d)"
          fila={masCrece}
          detalle={(f) => `Vende ${formatoUnidadesPorDia(f.velocidadPorVentana[7])} u/día esta semana frente a ${formatoUnidadesPorDia(f.velocidadPorVentana[30])} del mes`}
        />
        <Destacado titulo="El más quieto" fila={masQuieto} detalle={(f) => `${f.stock} u en bodega · ${f.diasCobertura === null ? "no se vendió en 30 días" : `alcanza para ${formatoDias(f.diasCobertura)}`}`} />
      </div>

      <h2 className={styles.tituloSeccion}>Ventas por día en cada ventana</h2>
      <Tabla
        encabezados={[
          "Producto",
          "ABC",
          ...VENTANAS_DIAS.map((d) => ({ clave: `v${d}`, contenido: `${d} d`, numerica: true })),
          "Tendencia",
          "Acción",
        ]}
      >
        {ordenadas.map((f) => (
          <FilaTabla key={f.skuId}>
            <CeldaTabla>
              <div className={styles.producto}>
                <strong>{f.nombre}</strong>
                <span className={styles.codigo}>
                  {f.codigo} · stock {f.stock} u
                </span>
              </div>
            </CeldaTabla>
            <CeldaTabla>
              <span className={styles.abc} title="A: los que más venden; C: los de menor aporte">
                {f.abc}
              </span>
            </CeldaTabla>
            {VENTANAS_DIAS.map((d) => {
              const v = f.velocidadPorVentana[d];
              // Más oscuro = más ventas por día. La cifra siempre está escrita, el color solo ayuda a ver el patrón.
              const fuerza = Math.round((v / maximo) * 45);
              return (
                <CeldaTabla key={d} numerica className={styles.celdaCalor}>
                  <span style={{ background: `color-mix(in srgb, var(--acento) ${fuerza}%, transparent)`, padding: "3px 8px", borderRadius: 6 }}>{formatoUnidadesPorDia(v)}</span>
                </CeldaTabla>
              );
            })}
            <CeldaTabla>
              <Tendencia porcentaje={f.tendenciaPorcentaje} />
            </CeldaTabla>
            <CeldaTabla>{accionSugerida(f)}</CeldaTabla>
          </FilaTabla>
        ))}
      </Tabla>
      <p className={styles.nota}>ABC: A es el grupo que junto vende el 80% de las unidades de 30 días (nunca debe faltar), B llega al 95% y C es el resto.</p>
    </>
  );
}
