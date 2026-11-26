import { formatearMoneda } from "@/lib/ml/sitios";
import type { Atribucion } from "@/lib/optimizacion/atribucion";
import { plataConSigno } from "./AtribucionIngresos";
import styles from "./analisis.module.css";

type Paso = { rotulo: string; texto: string; desde: number; hasta: number; tipo: "total" | "sube" | "baja" };

// Cascada: ingresos anteriores → ± visitas → ± conversión → ± ticket →
// ingresos actuales. Divs con posición porcentual, sin librerías. Solo
// con montos (verMontos): sin ese permiso la página no la pinta.
export function CascadaIngresos({ atribucion, siteId }: { atribucion: Atribucion; siteId: string }) {
  const a = Number(atribucion.ingresosAnterior);
  const v = Number(atribucion.aportes.visitas);
  const c = Number(atribucion.aportes.conversion);
  const t = Number(atribucion.aportes.ticket);
  const dir = (n: number): "sube" | "baja" => (n >= 0 ? "sube" : "baja");
  const pasos: Paso[] = [
    { rotulo: "Ingresos anteriores", texto: formatearMoneda(a, siteId), desde: 0, hasta: a, tipo: "total" },
    { rotulo: "Visitas", texto: plataConSigno(atribucion.aportes.visitas, siteId), desde: a, hasta: a + v, tipo: dir(v) },
    { rotulo: "Conversión", texto: plataConSigno(atribucion.aportes.conversion, siteId), desde: a + v, hasta: a + v + c, tipo: dir(c) },
    { rotulo: "Ticket", texto: plataConSigno(atribucion.aportes.ticket, siteId), desde: a + v + c, hasta: a + v + c + t, tipo: dir(t) },
    { rotulo: "Ingresos actuales", texto: formatearMoneda(Number(atribucion.ingresosActual), siteId), desde: 0, hasta: Number(atribucion.ingresosActual), tipo: "total" },
  ];
  const todos = pasos.flatMap((p) => [p.desde, p.hasta, 0]);
  const minimo = Math.min(...todos);
  const rango = Math.max(...todos) - minimo || 1;
  const pct = (n: number) => ((n - minimo) / rango) * 100;
  const frase = pasos.map((p) => `${p.rotulo}: ${p.texto}`).join(", ");

  return (
    <section aria-label="Cascada de ingresos">
      <p className={styles.seccion}>Cascada de ingresos</p>
      <div className={styles.cascada} role="img" aria-label={`Cascada de ingresos. ${frase}.`}>
        {pasos.map((p) => {
          const bajo = Math.min(p.desde, p.hasta);
          const alto = Math.max(p.desde, p.hasta);
          return (
            <div key={p.rotulo} className={styles.cascadaColumna} aria-hidden="true">
              <div className={styles.cascadaPista}>
                <span
                  className={styles.cascadaBarra}
                  data-tipo={p.tipo}
                  style={{ bottom: `${pct(bajo)}%`, height: `${Math.max(pct(alto) - pct(bajo), 0.8)}%` }}
                />
              </div>
              <span className={styles.cascadaValor} data-tipo={p.tipo}>
                {p.texto}
              </span>
              <span className={styles.cascadaRotulo}>{p.rotulo}</span>
            </div>
          );
        })}
      </div>
      {/* Los mismos números como tabla, solo para lectores de pantalla. */}
      <table className={styles.soloLectores}>
        <caption>Cascada de ingresos</caption>
        <thead>
          <tr>
            <th scope="col">Paso</th>
            <th scope="col">Monto</th>
          </tr>
        </thead>
        <tbody>
          {pasos.map((p) => (
            <tr key={p.rotulo}>
              <th scope="row">{p.rotulo}</th>
              <td>{p.texto}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
