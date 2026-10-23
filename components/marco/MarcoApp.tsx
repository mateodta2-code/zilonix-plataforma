import { BarraLateral } from "./BarraLateral";
import { BarraSuperior } from "./BarraSuperior";
import styles from "./MarcoApp.module.css";
import type { DatosUsuario, EmpresaSelector, GrupoNav } from "./tipos";

export function MarcoApp({
  empresa,
  empresaActivaId,
  empresasPropias,
  rol,
  grupos,
  usuario,
  mostrarCampana,
  children,
}: {
  empresa: { nombre: string; nit: string };
  empresaActivaId: string;
  empresasPropias: EmpresaSelector[];
  rol: string;
  grupos: GrupoNav[];
  usuario: DatosUsuario;
  mostrarCampana: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className={styles.marco}>
      <BarraLateral grupos={grupos} />
      <div className={styles.areaDerecha}>
        <BarraSuperior
          empresaActivaId={empresaActivaId}
          empresasPropias={empresasPropias}
          usuario={usuario}
          mostrarCampana={mostrarCampana}
        />
        <main className={styles.contenido}>
          <div className={styles.brillo} aria-hidden="true" />
          <div className={styles.contenidoInterior}>{children}</div>
        </main>
      </div>
    </div>
  );
}
