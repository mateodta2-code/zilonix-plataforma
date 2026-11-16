import type { ReactNode } from "react";
import { BarraLateral } from "./BarraLateral";
import { BarraSuperior } from "./BarraSuperior";
import styles from "./MarcoApp.module.css";
import type { DatosUsuario, EmpresaSelector, GrupoNav } from "./tipos";

// Marco único de todos los paneles (vendedor, superadmin, bodega,
// domiciliario). Lo propio del vendedor (empresa, selector de empresas,
// campana) es opcional: sin ello el marco se ve igual, solo sin esas
// piezas. `etiquetaPanel` (ej. "Superadmin") va debajo del logo;
// `cerrarSesion` reemplaza el botón de Clerk cuando el panel tiene su
// propio cierre de sesión (superadmin).
export function MarcoApp({
  empresaActivaId,
  empresasPropias = [],
  grupos,
  usuario,
  mostrarCampana = false,
  etiquetaPanel,
  cerrarSesion,
  mostrarMisDatos = true,
  children,
}: {
  empresa?: { nombre: string; nit: string };
  empresaActivaId?: string;
  empresasPropias?: EmpresaSelector[];
  rol?: string;
  grupos: GrupoNav[];
  usuario: DatosUsuario;
  mostrarCampana?: boolean;
  etiquetaPanel?: string;
  cerrarSesion?: ReactNode;
  mostrarMisDatos?: boolean;
  children: ReactNode;
}) {
  return (
    <div className={styles.marco}>
      <BarraLateral grupos={grupos} etiquetaPanel={etiquetaPanel} mostrarMisDatos={mostrarMisDatos} />
      <div className={styles.areaDerecha}>
        <BarraSuperior
          empresaActivaId={empresaActivaId}
          empresasPropias={empresasPropias}
          usuario={usuario}
          mostrarCampana={mostrarCampana}
          cerrarSesion={cerrarSesion}
        />
        <main className={styles.contenido}>
          <div className={styles.brillo} aria-hidden="true" />
          <div className={styles.contenidoInterior}>{children}</div>
        </main>
      </div>
    </div>
  );
}
