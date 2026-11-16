import { IconoCerrarSesion } from "./iconos";
import styles from "./BotonCerrarSesion.module.css";

// Mismo botón "Cerrar sesión" de la barra, pero con una server action
// propia en vez del signOut de Clerk (superadmin: además de la sesión
// de Clerk borra su cookie zx_superadmin). Mismas clases, mismo aspecto.
export function BotonCerrarSesionAccion({ accion }: { accion: () => void | Promise<void> }) {
  return (
    <form action={accion}>
      <button type="submit" className={`${styles.boton} ${styles.barra}`} title="Cerrar sesión">
        <IconoCerrarSesion size={16} />
        <span>Cerrar sesión</span>
      </button>
    </form>
  );
}
