import { Chip } from "@/components/marco/Chip";
import { CeldaTabla, FilaTabla, Tabla, type EncabezadoTabla } from "@/components/marco/Tabla";
import type { RentabilidadPintada } from "./vista";
import styles from "./page.module.css";

const ENCABEZADOS: EncabezadoTabla[] = [
  { clave: "campana", contenido: "Campaña", fija: true },
  { clave: "roas", contenido: "ROAS actual" },
  { clave: "equilibrio", contenido: "ROAS equilibrio" },
  { clave: "margen", contenido: "Margen después de Ads" },
  { clave: "estado", contenido: "Estado" },
];

// Rentabilidad Ads (14-nov, como el tablero de referencia de Melisa).
// Solo lectura: margen fijo de la config hasta que exista una pantalla
// para editarlo por empresa.
export function RentabilidadAds({ datos }: { datos: RentabilidadPintada }) {
  return (
    <section className={styles.panelDatos} aria-label="Rentabilidad Ads">
      <p className={styles.seccion}>Rentabilidad Ads</p>
      <p className={styles.nota}>
        Con un margen del producto de {datos.margen}, la publicidad no deja pérdida mientras el ROAS sea al menos{" "}
        <strong>{datos.roasEquilibrio}</strong> (ACOS máximo {datos.acosMaximo}). Una campaña es rentable si después de pagar la
        publicidad queda al menos {datos.minimo}. Margen después de Ads = margen del producto − ACOS.
      </p>
      {datos.filas.length === 0 ? null : (
        <Tabla encabezados={ENCABEZADOS}>
          {datos.filas.map((fila) => (
            <FilaTabla key={fila.id}>
              <CeldaTabla fija>{fila.nombre}</CeldaTabla>
              <CeldaTabla numerica>{fila.roas}</CeldaTabla>
              <CeldaTabla numerica>{datos.roasEquilibrio}</CeldaTabla>
              <CeldaTabla numerica>{fila.margenPostAds}</CeldaTabla>
              <CeldaTabla>
                <Chip estado={fila.tono}>{fila.rotulo}</Chip>
              </CeldaTabla>
            </FilaTabla>
          ))}
        </Tabla>
      )}
      <p className={styles.nota}>El margen de {datos.margen} es un valor general por ahora, no el de cada producto.</p>
    </section>
  );
}
