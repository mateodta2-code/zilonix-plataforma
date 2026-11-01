"use client";

import type { Cuenta } from "./CuentasDestino";
import { ImportarPorBookmarklet } from "./importadores/ImportarPorBookmarklet";
import { ImportarPorLink } from "./importadores/ImportarPorLink";
import { ImportarPorSku } from "./importadores/ImportarPorSku";
import type { ItemImportado } from "./formulario-logica";
import styles from "./publicar.module.css";

// Parte 3, punto A — reemplaza los 3 "Próximamente" de
// SeccionesImportarPlaceholder.tsx (Parte 2) por los 3 importadores
// reales, misma UX de marca (<details> plegados, cerrados por
// defecto). Los 3 caminos llegan al MISMO lugar (PaginaPublicar.tsx
// hidrata el formulario con construirEstadoInicialDesdeImportacion) —
// nunca publican nada todavía, solo precargan.
export function SeccionesImportar({
  cuentas,
  itemImportado,
  importarOrigen,
  skuNoEncontrado,
  linkError,
  noDisponible,
  onImportarBookmarklet,
}: {
  cuentas: Cuenta[];
  itemImportado: ItemImportado | null;
  importarOrigen: string;
  skuNoEncontrado: string;
  linkError: string;
  noDisponible: boolean;
  onImportarBookmarklet: (item: ItemImportado) => void;
}) {
  return (
    <div id="importar" style={{ marginTop: 16, display: "flex", flexDirection: "column", gap: 8 }}>
      <details className={styles.recuadroMarca}>
        <summary className={styles.resumenDetalle}>Importar publicación por SKU</summary>
        <div className={styles.cuerpoDetalle}>
          <ImportarPorSku cuentas={cuentas} skuNoEncontrado={skuNoEncontrado} importado={Boolean(itemImportado) && importarOrigen === "sku"} />
        </div>
      </details>
      <details className={styles.recuadroMarca}>
        <summary className={styles.resumenDetalle}>Importar publicación desde un link</summary>
        <div className={styles.cuerpoDetalle}>
          <ImportarPorLink
            linkError={linkError}
            noDisponible={noDisponible && importarOrigen === "link"}
            importado={Boolean(itemImportado) && importarOrigen === "link"}
          />
        </div>
      </details>
      <details className={styles.recuadroMarca}>
        <summary className={styles.resumenDetalle}>Importar con el botón del navegador</summary>
        <div className={styles.cuerpoDetalle}>
          <ImportarPorBookmarklet onImportar={onImportarBookmarklet} />
        </div>
      </details>
    </div>
  );
}
