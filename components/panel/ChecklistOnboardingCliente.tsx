"use client";

import { useEffect, useState } from "react";
import { BotonLink } from "@/components/marco/Boton";
import { IconoCheck } from "@/components/marco/iconos";
import { Tarjeta } from "@/components/marco/Tarjeta";
import styles from "./ChecklistOnboarding.module.css";

export type PasoChecklist = {
  clave: string;
  titulo: string;
  hecho: boolean;
  // Solo si falta este paso Y la persona tiene acceso a esa pantalla —
  // ChecklistOnboarding.tsx ya decide eso, acá solo se pinta.
  href?: string;
  etiquetaBoton?: string;
};

function claveOculto(empresaId: string): string {
  return `zilonix-onboarding-oculto-${empresaId}`;
}

// "Se puede saltar y retomar" (#323, alineado con #60) — mismo patrón
// de localStorage que SelectorTema.tsx: por empresa (no por usuario,
// para no confundir a dos personas del mismo equipo viendo estados
// distintos sin motivo de negocio) y nunca se rompe si el storage
// está bloqueado (ventana privada), solo deja de recordarlo.
export function ChecklistOnboardingCliente({ empresaId, pasos }: { empresaId: string; pasos: PasoChecklist[] }) {
  const [oculto, setOculto] = useState(false);

  useEffect(() => {
    try {
      setOculto(localStorage.getItem(claveOculto(empresaId)) === "1");
    } catch {
      // Ventana privada o storage bloqueado — se muestra siempre.
    }
  }, [empresaId]);

  function saltar() {
    setOculto(true);
    try {
      localStorage.setItem(claveOculto(empresaId), "1");
    } catch {
      // Se oculta igual en esta visita, solo no se recuerda la próxima.
    }
  }

  function volverAMostrar() {
    setOculto(false);
    try {
      localStorage.removeItem(claveOculto(empresaId));
    } catch {
      // No hay nada que limpiar si nunca se guardó.
    }
  }

  if (oculto) {
    return (
      <button type="button" className={styles.reabrir} onClick={volverAMostrar}>
        Ver los primeros pasos
      </button>
    );
  }

  return (
    <Tarjeta className={styles.tarjeta}>
      <div className={styles.encabezado}>
        <h2 className={styles.titulo}>Primeros pasos</h2>
        <button type="button" className={styles.saltar} onClick={saltar}>
          Saltar por ahora
        </button>
      </div>
      <ol className={styles.lista}>
        {pasos.map((paso, indice) => (
          <li key={paso.clave} className={styles.paso} data-hecho={paso.hecho}>
            <span className={styles.marca} aria-hidden="true">
              {paso.hecho ? <IconoCheck size={14} /> : indice + 1}
            </span>
            <span className={styles.textoPaso}>{paso.titulo}</span>
            {paso.href && (
              <BotonLink href={paso.href} variante="secundario" chico className={styles.boton}>
                {paso.etiquetaBoton}
              </BotonLink>
            )}
          </li>
        ))}
      </ol>
    </Tarjeta>
  );
}
