import { Boton } from "@/components/marco/Boton";
import { Tarjeta } from "@/components/marco/Tarjeta";
import { CUENTA_TODAS, PARAM_CUENTA } from "@/lib/ml/selector-cuenta";
import styles from "./BarraFiltrosPosventa.module.css";

// Barra de filtros única de las 3 pestañas de Posventa (Refs #647): un solo
// <form method="get"> con buscador, cuenta, un tercer campo propio de la
// pestaña (orden, periodo o fecha) y UN botón «Aplicar». Server Component,
// sin onChange. La página es quien valida la cuenta del query
// (leerCuentaMlDeQuery) y pasa solo id y apodo de cuentas de SU empresa.

type Opcion = { valor: string; etiqueta: string };

export type CampoExtraBarra =
  | { tipo: "select"; nombre: string; etiqueta: string; valor: string; opciones: Opcion[] }
  | { tipo: "fecha"; nombre: string; etiqueta: string; valor: string };

export function BarraFiltrosPosventa({
  busqueda,
  placeholder,
  cuentas,
  cuentaId,
  extra,
  ocultos,
}: {
  busqueda: string;
  placeholder: string;
  cuentas: { id: string; apodo: string }[];
  cuentaId: string | null;
  extra: CampoExtraBarra;
  // Los demás parámetros de la pestaña (p. ej. estado) para no perderlos.
  ocultos?: Record<string, string | null | undefined>;
}) {
  const idExtra = `posventa-filtro-${extra.nombre}`;
  return (
    <Tarjeta className={styles.contenedor}>
      <form method="get" className={styles.formulario}>
        {Object.entries(ocultos ?? {}).map(([clave, valor]) => (valor ? <input key={clave} type="hidden" name={clave} value={valor} /> : null))}

        <div className={`${styles.campo} ${styles.ancho}`}>
          <label htmlFor="posventa-filtro-q" className={styles.etiqueta}>
            Buscar
          </label>
          <input id="posventa-filtro-q" type="search" name="q" defaultValue={busqueda} placeholder={placeholder} maxLength={80} className="zx-control" />
        </div>

        <div className={styles.campo}>
          <label htmlFor="posventa-filtro-cuenta" className={styles.etiqueta}>
            Cuenta de Mercado Libre
          </label>
          <select id="posventa-filtro-cuenta" name={PARAM_CUENTA} key={cuentaId ?? CUENTA_TODAS} defaultValue={cuentaId ?? CUENTA_TODAS} className="zx-control">
            <option value={CUENTA_TODAS}>Todas</option>
            {cuentas.map((c) => (
              <option key={c.id} value={c.id}>
                {c.apodo}
              </option>
            ))}
          </select>
        </div>

        <div className={styles.campo}>
          <label htmlFor={idExtra} className={styles.etiqueta}>
            {extra.etiqueta}
          </label>
          {extra.tipo === "select" ? (
            <select id={idExtra} name={extra.nombre} defaultValue={extra.valor} className="zx-control">
              {extra.opciones.map((o) => (
                <option key={o.valor} value={o.valor}>
                  {o.etiqueta}
                </option>
              ))}
            </select>
          ) : (
            <input id={idExtra} type="date" name={extra.nombre} defaultValue={extra.valor} className="zx-control" />
          )}
        </div>

        <Boton type="submit" className={styles.boton}>
          Aplicar
        </Boton>
      </form>
    </Tarjeta>
  );
}
