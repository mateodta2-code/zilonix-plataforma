import { formatearMoneda, formatearNumero } from "@/lib/ml/sitios";
import { aCentavos } from "@/lib/finanzas/utilidad-venta";
import { ETIQUETA_POCAS_VENTAS, factorPrincipal, rotuloFactor, type Atribucion, type FactorIngresos } from "@/lib/optimizacion/atribucion";
import styles from "./analisis.module.css";

const FACTORES: { clave: FactorIngresos; rotulo: string }[] = [
  { clave: "visitas", rotulo: "Visitas" },
  { clave: "conversion", rotulo: "Conversión" },
  { clave: "ticket", rotulo: "Ticket" },
];

// Plata con signo explícito: «+$ 1.200», «−$ 300». Nunca un símbolo fijo.
export function plataConSigno(valor: string, siteId: string): string {
  const centavos = aCentavos(valor);
  const texto = formatearMoneda(Math.abs(Number(valor)), siteId);
  return centavos > BigInt(0) ? `+${texto}` : centavos < BigInt(0) ? `−${texto}` : texto;
}

// Variación porcentual de los ingresos; null si antes no había nada.
export function porcentajeCambio(cambio: string, anterior: string, idioma: string): string | null {
  const base = Number(anterior);
  if (!(base > 0)) return null;
  const n = (Number(cambio) / base) * 100;
  return `${n > 0 ? "+" : n < 0 ? "−" : ""}${formatearNumero(Math.round(Math.abs(n) * 10) / 10, idioma)} %`;
}

// «Tus ingresos subieron $ 200 (+20 %), principalmente por tráfico.»
export function fraseIngresos(a: Atribucion, siteId: string, idioma: string, verMontos: boolean): string {
  const sube = aCentavos(a.cambio) >= BigInt(0);
  const verbo = sube ? "subieron" : "bajaron";
  const pct = porcentajeCambio(a.cambio, a.ingresosAnterior, idioma);
  const monto = verMontos ? formatearMoneda(Math.abs(Number(a.cambio)), siteId) : null;
  const medida = [monto, pct ? `(${pct})` : null].filter(Boolean).join(" ");
  const f = factorPrincipal(a.aportes, a.cambio);
  return `Tus ingresos ${verbo}${medida ? ` ${medida}` : ""}${f ? `, principalmente por ${rotuloFactor(f)}` : ""}.`;
}

function valorFactor(a: Atribucion, f: FactorIngresos, lado: "antes" | "ahora", siteId: string, idioma: string, verMontos: boolean): string {
  if (f === "visitas") return formatearNumero(a.visitas[lado], idioma);
  if (f === "conversion") return `${formatearNumero(Math.round(a.conversion[lado] * 10000) / 100, idioma)} %`;
  return verMontos ? formatearMoneda(Number(a.ticket[lado]), siteId) : "—";
}

// Tarjeta principal del Análisis: la frase y las 3 barras con el aporte de
// cada factor (positivo o negativo), en plata si se pueden ver montos y en
// puntos porcentuales de los ingresos anteriores si no.
export function AtribucionIngresos({
  atribucion,
  muestraSuficiente,
  visitasDisponibles,
  canceladas,
  siteId,
  idioma,
  verMontos,
}: {
  atribucion: Atribucion | null;
  muestraSuficiente: boolean;
  visitasDisponibles: boolean;
  canceladas: number;
  siteId: string;
  idioma: string;
  verMontos: boolean;
}) {
  const aviso = canceladas > 0 ? `Se excluyeron ${canceladas} ${canceladas === 1 ? "venta cancelada" : "ventas canceladas"}.` : null;
  if (!atribucion) {
    const motivo = !visitasDisponibles
      ? "Mercado Libre no devolvió las visitas de la tienda; sin ellas no se puede repartir el cambio."
      : !muestraSuficiente
        ? `${ETIQUETA_POCAS_VENTAS}: hace falta al menos 3 ventas o 50 visitas en alguno de los dos períodos.`
        : "No hubo ventas en ninguno de los dos períodos, o faltan visitas para calcular la conversión.";
    return (
      <section className={styles.tarjetaPrincipal} aria-label="Por qué cambiaron tus ingresos">
        <p className={styles.frase}>{motivo}</p>
        {aviso ? <p className={styles.nota}>{aviso}</p> : null}
      </section>
    );
  }

  const aportes = FACTORES.map((f) => ({ ...f, valor: Number(atribucion.aportes[f.clave]) }));
  const maximo = Math.max(...aportes.map((a) => Math.abs(a.valor)), 0.01);
  const base = Number(atribucion.ingresosAnterior);
  return (
    <section className={styles.tarjetaPrincipal} aria-label="Por qué cambiaron tus ingresos">
      <p className={styles.frase}>{fraseIngresos(atribucion, siteId, idioma, verMontos)}</p>
      <p className={styles.nota}>
        Ingresos = visitas × conversión × ticket. El reparto no depende del orden de los factores.
        {aviso ? ` ${aviso}` : ""}
      </p>
      <ul className={styles.barras}>
        {aportes.map((a) => {
          const signo = a.valor > 0 ? "sube" : a.valor < 0 ? "baja" : "igual";
          const texto = verMontos
            ? plataConSigno(atribucion.aportes[a.clave], siteId)
            : base > 0
              ? `${a.valor > 0 ? "+" : a.valor < 0 ? "−" : ""}${formatearNumero(Math.round(Math.abs(a.valor / base) * 1000) / 10, idioma)} %`
              : "—";
          return (
            <li key={a.clave} className={styles.barra}>
              <span className={styles.barraRotulo}>{a.rotulo}</span>
              <span className={styles.barraPista} aria-hidden="true">
                <span className={styles.barraRelleno} data-signo={signo} style={{ width: `${(Math.abs(a.valor) / maximo) * 100}%` }} />
              </span>
              <span className={styles.barraAporte} data-signo={signo}>
                {texto}
              </span>
              <span className={styles.barraValores}>
                {`${valorFactor(atribucion, a.clave, "antes", siteId, idioma, verMontos)} → ${valorFactor(atribucion, a.clave, "ahora", siteId, idioma, verMontos)}`}
              </span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
