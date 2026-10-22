import styles from "./Tarjeta.module.css";

// Contenedor plano con borde fino — para envolver un formulario o una
// sección, sin el hover/elevación de TarjetaKpi (esta no es clicable).
export function Tarjeta({ children, className }: { children: React.ReactNode; className?: string }) {
  return <div className={[styles.tarjeta, className].filter(Boolean).join(" ")}>{children}</div>;
}
