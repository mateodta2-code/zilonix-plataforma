"use client";

import { usePathname } from "next/navigation";
import styles from "./BarraSuperior.module.css";

// Mismo criterio que ItemNavLink.tsx: BarraSuperior (vía MarcoApp y
// app/panel/layout.tsx) corre una sola vez para TODAS las subrutas de
// /panel — un layout de servidor no sabe en qué subruta está parado.
// Este componente chico, aparte, es el único que necesita
// usePathname() para decidir si el saludo se ve.
//
// Pedido de Mateo post-#120: el saludo grande es SOLO de Inicio. En
// cualquier otra subruta de /panel desaparece — no se encoge, no
// queda chico: no está.
export function SaludoHeader({ nombre }: { nombre: string }) {
  const pathname = usePathname();

  if (pathname !== "/panel") return null;

  return <h1 className={styles.saludo}>Hola, {nombre}</h1>;
}
