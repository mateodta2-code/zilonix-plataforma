"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { iconoDeClave } from "./iconos";
import styles from "./BarraLateral.module.css";
import type { ItemNav } from "./tipos";

// BarraLateral (y su layout, app/panel/layout.tsx) corren una sola vez
// para TODAS las subrutas de /panel — un layout de servidor no sabe
// en qué subruta está parado. Este componente chico, aparte, es el
// único que necesita usePathname() para resaltar el ítem real.
function esRutaActiva(pathname: string | null, href: string): boolean {
  if (!pathname) return false;
  if (href === "/panel") return pathname === "/panel";
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function ItemNavLink({ item, colapsada }: { item: ItemNav; colapsada: boolean }) {
  const pathname = usePathname();

  if (item.deshabilitada) {
    return (
      <span className={styles.item} data-deshabilitado="true" title={item.titulo}>
        {iconoDeClave(item.icono, { size: 18 })}
        {!colapsada && <span className={styles.etiquetaItem}>{item.etiqueta}</span>}
      </span>
    );
  }

  return (
    <Link
      href={item.href}
      className={styles.item}
      data-activo={esRutaActiva(pathname, item.href) ? "true" : "false"}
      title={colapsada ? item.etiqueta : undefined}
    >
      {iconoDeClave(item.icono, { size: 18 })}
      {!colapsada && <span className={styles.etiquetaItem}>{item.etiqueta}</span>}
    </Link>
  );
}
