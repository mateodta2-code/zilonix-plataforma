// Issue #262 (revisión de Mateo, punto 3) — conSigno/celdaConDelta
// vivían dentro de page.tsx, que importa cosas server-only (db,
// obtenerOCrearUsuarioActual, cookies) — hacían falta Postgres real
// solo para poder importar estas DOS funciones puras en una prueba.
// Movidas a este módulo aparte (solo depende de calcularDelta, que ya
// era puro) para poder probarlas sin DATABASE_URL_APP.
import { calcularDelta } from "@/lib/seguimiento/comparativa";
import { vendidosEstimados } from "@/lib/seguimiento/aproximados";
import styles from "./page.module.css";

// Issue #195 — "valor + delta" (ej. 9 (−1)) cuando hay foto anterior
// con la que comparar; solo el valor cuando no hay. `formatearValor`
// decide cómo se ve el número entero (dinero() para precio, tal cual
// para inventario/vendidos); el delta usa el mismo formateador, con
// signo explícito agregado acá (nunca "+"/"-" adivinados adentro del
// formateador, que solo sabe mostrar valores absolutos).
export function conSigno(n: number, formatearValor: (n: number) => string): string {
  if (n === 0) return formatearValor(0);
  return n > 0 ? `+${formatearValor(n)}` : `-${formatearValor(Math.abs(n))}`;
}

export function celdaConDelta(actual: number | string | null, anterior: number | string | null, formatearValor: (n: number) => string): React.ReactNode {
  if (actual == null) return "—";
  const texto = formatearValor(Number(actual));
  const delta = calcularDelta(actual, anterior);
  // Issue #262 (revisión de Mateo) — bug real: "$939.900 ($0)" en el
  // Colchón Relax — un delta de 0 (el precio de hoy es IGUAL al de
  // ayer, no "bajó a cero") se mostraba como "($0)", que se lee como
  // si el precio ANTERIOR fuera literalmente cero/vacío. Un delta de
  // 0 no aporta nada que valga la pena resaltar — nunca se muestra el
  // paréntesis, para precio/inventario/vendidos, cuando no hay cambio
  // real.
  if (delta == null || delta === 0) return texto;
  const signo = delta > 0 ? "positivo" : "negativo";
  return (
    <>
      {texto} <span className={styles.delta} data-signo={signo}>({conSigno(delta, formatearValor)})</span>
    </>
  );
}

// Issue #251 (fix "aproximados siempre visibles") — bug real probado
// en staging: la lista exigía `esFull != null` antes de estimar
// NADA — sin ese dato confirmado (la mayoría de los seguimientos
// nuevos, antes de que la API/extensión lo lean) la fila se quedaba
// sin ningún estimado de vendidos, aunque sí hubiera un "+N vendidos"
// para ajustar. Ahora, con Full desconocido, se asume el factor "no
// Full" (1.55, el mismo criterio que vendidosEstimados ya usa cuando
// `esFull` no es exactamente `true`) — la UI avisa "Full desconocido"
// aparte (page.tsx), nunca se esconde la suposición.
export function vendidosAproxParaFila(tipo: "producto" | "tienda", vendidosParaAprox: number | null, vendidosExacto: boolean, esFull: boolean | null): number | null {
  if (tipo !== "producto" || vendidosParaAprox == null) return null;
  return vendidosEstimados(vendidosParaAprox, { exacto: vendidosExacto, esFull: esFull === true });
}
