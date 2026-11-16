import { Chip } from "@/components/marco/Chip";
import { CeldaTabla, FilaTabla, Tabla, type EncabezadoTabla } from "@/components/marco/Tabla";
import type { CambioPintado } from "./vista";
import styles from "./page.module.css";

const ENCABEZADOS: EncabezadoTabla[] = [
  { clave: "fecha", contenido: "Detectado" },
  { clave: "campana", contenido: "Campaña" },
  { clave: "que", contenido: "Qué cambió" },
  { clave: "antes", contenido: "Antes", numerica: true },
  { clave: "ahora", contenido: "Ahora", numerica: true },
  { clave: "direccion", contenido: "" },
];

// Historial de presupuesto y ROAS objetivo (como el tablero de
// referencia de Melisa). Lo anota la sincronización al ver que el valor
// cambió desde la lectura anterior.
export function CambiosCampanas({ cambios, dias }: { cambios: CambioPintado[]; dias: number }) {
  return (
    <section className={styles.panelDatos} aria-label="Cambios de presupuesto y ROAS">
      <p className={styles.seccion}>Cambios de presupuesto y ROAS</p>
      {cambios.length === 0 ? (
        <p className={styles.nota}>
          Sin cambios en los últimos {dias} días. Cuando cambies el presupuesto diario o el ROAS objetivo de una campaña en Mercado
          Libre, aparece acá después de la siguiente actualización.
        </p>
      ) : (
        <>
          <p className={styles.nota}>
            Últimos {dias} días. La fecha es cuando Zilonix lo vio al actualizar, no la hora exacta en que se cambió en Mercado Libre.
          </p>
          <Tabla encabezados={ENCABEZADOS}>
            {cambios.map((cambio) => (
              <FilaTabla key={cambio.id}>
                <CeldaTabla>{cambio.fecha}</CeldaTabla>
                <CeldaTabla>{cambio.campana}</CeldaTabla>
                <CeldaTabla>{cambio.que}</CeldaTabla>
                <CeldaTabla numerica>{cambio.antes}</CeldaTabla>
                <CeldaTabla numerica>{cambio.ahora}</CeldaTabla>
                <CeldaTabla>
                  <Chip estado={cambio.tono}>{cambio.direccion}</Chip>
                </CeldaTabla>
              </FilaTabla>
            ))}
          </Tabla>
        </>
      )}
    </section>
  );
}
