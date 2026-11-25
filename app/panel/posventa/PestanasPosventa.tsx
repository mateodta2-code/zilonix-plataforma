"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { etiquetaConConteo, PESTANAS_POSVENTA, pestanaActivaPosventa, type ClavePestanaPosventa } from "./pestanas";
import styles from "./Posventa.module.css";

// Cliente solo para saber la ruta activa; los contadores llegan ya
// calculados por el layout (null = sin número).
export function PestanasPosventa({ conteos }: { conteos: Partial<Record<ClavePestanaPosventa, number | null>> }) {
  const activa = pestanaActivaPosventa(usePathname() ?? "");
  return (
    <nav className={styles.chips} aria-label="Secciones de Posventa">
      {PESTANAS_POSVENTA.map((p) =>
        p.lista ? (
          <Link key={p.clave} href={p.href} className={styles.chip} data-activa={activa === p.clave ? "true" : "false"}>
            {etiquetaConConteo(p.etiqueta, conteos[p.clave] ?? null)}
          </Link>
        ) : (
          <span key={p.clave} className={styles.chip} data-deshabilitada="true">
            {p.etiqueta}
            <span className={styles.pronto}>Muy pronto</span>
          </span>
        )
      )}
    </nav>
  );
}
