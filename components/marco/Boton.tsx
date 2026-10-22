import Link from "next/link";
import styles from "./Boton.module.css";

export type VarianteBoton = "primario" | "secundario" | "fantasma";

// Exportada porque algunos links tienen que ser <a> normales, no
// next/link — ej. /api/ml/conectar (arranca el OAuth real de Mercado
// Libre): es un Route Handler, no una página, y necesita una
// navegación de verdad del navegador, no una transición cliente.
export function clasesBoton(variante: VarianteBoton, chico?: boolean, className?: string): string {
  return [styles.boton, styles[variante], chico ? styles.chico : "", className].filter(Boolean).join(" ");
}

// <button> — para submits de formularios y acciones (nunca cambia el
// method/action del form, solo cómo se ve).
export function Boton({
  variante = "primario",
  chico,
  className,
  ...resto
}: { variante?: VarianteBoton; chico?: boolean } & React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return <button className={clasesBoton(variante, chico, className)} {...resto} />;
}

// <Link> — para navegación con la misma apariencia que Boton (ej.
// "Cancelar" al lado de un submit, o un link que hace de botón
// primario como "Conectar Mercado Libre").
export function BotonLink({
  variante = "secundario",
  chico,
  className,
  href,
  ...resto
}: { variante?: VarianteBoton; chico?: boolean; href: string } & React.ComponentProps<typeof Link>) {
  return <Link href={href} className={clasesBoton(variante, chico, className)} {...resto} />;
}
