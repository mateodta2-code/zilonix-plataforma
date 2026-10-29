import styles from "./publicar.module.css";

// Punto 2 del pedido — "Tres secciones plegables (cerradas por
// defecto) como placeholders visibles 'Próximamente': Importar
// publicación por SKU, Importar publicación desde un link, Importar
// con el botón del navegador. Solo UI; la lógica va en la Parte 3."
// <details> nativo (sin JS ni librería) — "cerradas por defecto" es
// simplemente no poner el atributo `open`. ADENDO de diseño — cada
// una lleva el anillo de marca (.recuadroMarca, publicar.module.css).
export function SeccionesImportarPlaceholder() {
  return (
    <div style={{ marginTop: 16, display: "flex", flexDirection: "column", gap: 8 }}>
      <details className={styles.recuadroMarca}>
        <summary className={styles.resumenDetalle}>Importar publicación por SKU</summary>
        <p className={styles.cuerpoDetalle}>Próximamente — vas a poder traer los datos de una publicación propia ya existente escribiendo su SKU.</p>
      </details>
      <details className={styles.recuadroMarca}>
        <summary className={styles.resumenDetalle}>Importar publicación desde un link</summary>
        <p className={styles.cuerpoDetalle}>Próximamente — vas a poder pegar el link de cualquier publicación de Mercado Libre (propia o de la competencia) para usarla como base.</p>
      </details>
      <details className={styles.recuadroMarca}>
        <summary className={styles.resumenDetalle}>Importar con el botón del navegador</summary>
        <p className={styles.cuerpoDetalle}>Próximamente — un botón para arrastrar a la barra de marcadores que trae los datos de la publicación que tengas abierta en el navegador.</p>
      </details>
    </div>
  );
}
