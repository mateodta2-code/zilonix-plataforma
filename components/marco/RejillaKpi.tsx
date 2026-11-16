import type { ReactNode } from "react";
import styles from "./RejillaKpi.module.css";

// Fila de TarjetaKpi: 4 columnas, 2 en tablet, 1 en celular — la misma
// rejilla que usa /panel (page.module.css, .gridKpi).
export function RejillaKpi({ children }: { children: ReactNode }) {
  return <div className={styles.rejilla}>{children}</div>;
}
