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

// Issue #323 (ver guía) — clave independiente de claveOculto: esta
// marca "la persona pidió ver la guía después de completarla", nunca
// se mezcla con "Saltar por ahora" (que solo aplica mientras falta
// algún paso). Por eso conviven sin migración: cada una se activa en
// un estado distinto del checklist.
function claveGuiaAbierta(empresaId: string): string {
  return `zilonix-onboarding-guia-${empresaId}`;
}

function ListaPasos({ pasos }: { pasos: PasoChecklist[] }) {
  return (
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
  );
}

// "Se puede saltar y retomar" (#323, alineado con #60) — mismo patrón
// de localStorage que SelectorTema.tsx: por empresa (no por usuario,
// para no confundir a dos personas del mismo equipo viendo estados
// distintos sin motivo de negocio) y nunca se rompe si el storage
// está bloqueado (ventana privada), solo deja de recordarlo.
export function ChecklistOnboardingCliente({
  empresaId,
  pasos,
  completo,
}: {
  empresaId: string;
  pasos: PasoChecklist[];
  completo: boolean;
}) {
  // null = "todavía no se leyó localStorage" (nada de nada se pinta en
  // ese instante) — si arrancara en false como el resto del estado,
  // esta tarjeta completa saldría pintada un instante después de la
  // hidratación aunque ya estuviera saltada, y recién ahí colapsaría
  // al botón de "Ver los primeros pasos". Ese parpadeo es peor que el
  // de SelectorTema.tsx (un ícono) porque es toda la tarjeta.
  const [oculto, setOculto] = useState<boolean | null>(null);
  // Mismo parpadeo a evitar, pero para el estado de "completo": arranca
  // en null y solo se usa cuando completo === true.
  const [guiaAbierta, setGuiaAbierta] = useState<boolean | null>(null);

  useEffect(() => {
    try {
      setOculto(localStorage.getItem(claveOculto(empresaId)) === "1");
    } catch {
      // Ventana privada o storage bloqueado — se muestra siempre.
      setOculto(false);
    }
  }, [empresaId]);

  useEffect(() => {
    if (!completo) return;
    try {
      setGuiaAbierta(localStorage.getItem(claveGuiaAbierta(empresaId)) === "1");
    } catch {
      setGuiaAbierta(false);
    }
  }, [empresaId, completo]);

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

  function abrirGuia() {
    setGuiaAbierta(true);
    try {
      localStorage.setItem(claveGuiaAbierta(empresaId), "1");
    } catch {
      // Se abre igual en esta visita, solo no se recuerda la próxima.
    }
  }

  function cerrarGuia() {
    setGuiaAbierta(false);
    try {
      localStorage.removeItem(claveGuiaAbierta(empresaId));
    } catch {
      // No hay nada que limpiar si nunca se guardó.
    }
  }

  if (completo) {
    if (guiaAbierta === null) return null;

    if (!guiaAbierta) {
      return (
        <button type="button" className={styles.reabrir} onClick={abrirGuia}>
          Ver guía de inicio
        </button>
      );
    }

    return (
      <Tarjeta className={styles.tarjeta}>
        <div className={styles.encabezado}>
          <h2 className={styles.titulo}>Primeros pasos</h2>
          <button type="button" className={styles.saltar} onClick={cerrarGuia}>
            Cerrar
          </button>
        </div>
        <p className={styles.mensajeCompleto}>Ya completaste la guía de inicio.</p>
        <ListaPasos pasos={pasos} />
      </Tarjeta>
    );
  }

  if (oculto === null) return null;

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
      <ListaPasos pasos={pasos} />
    </Tarjeta>
  );
}
