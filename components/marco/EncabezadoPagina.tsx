import styles from "./EncabezadoPagina.module.css";

// Título de página + descripción opcional + una acción opcional a la
// derecha (un botón, un link) — mismo patrón repetido en casi todas
// las subpáginas de /panel, antes como un <h1 style={{...}}> suelto.
export function EncabezadoPagina({
  titulo,
  descripcion,
  accion,
}: {
  titulo: string;
  descripcion?: React.ReactNode;
  accion?: React.ReactNode;
}) {
  return (
    <div className={styles.encabezado}>
      <div>
        <h1 className={`${styles.titulo} zx-texto-plata`}>{titulo}</h1>
        {descripcion && <p className={styles.descripcion}>{descripcion}</p>}
      </div>
      {accion && <div className={styles.accion}>{accion}</div>}
    </div>
  );
}
