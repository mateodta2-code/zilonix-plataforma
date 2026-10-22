import Link from "next/link";
import styles from "./Pestanas.module.css";

export type Pestana = { etiqueta: string; href: string; activa: boolean; deshabilitada?: boolean };

export function Pestanas({ pestanas }: { pestanas: Pestana[] }) {
  return (
    <nav className={styles.contenedor}>
      {pestanas.map((pestana) =>
        pestana.deshabilitada ? (
          <span key={pestana.href} className={styles.pestana} data-deshabilitada="true">
            {pestana.etiqueta}
          </span>
        ) : (
          <Link key={pestana.href} href={pestana.href} className={styles.pestana} data-activa={pestana.activa ? "true" : "false"}>
            {pestana.etiqueta}
          </Link>
        )
      )}
    </nav>
  );
}
