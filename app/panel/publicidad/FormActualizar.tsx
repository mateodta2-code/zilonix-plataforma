"use client";

import { useTransition } from "react";
import { Boton } from "@/components/marco/Boton";
import { actualizarPublicidadAction } from "./actions";
import styles from "./page.module.css";

// "Actualizar ahora" puede tardar hasta 4 minutos (el mismo presupuesto
// de 240 s que el cron). Sin aviso parecía que el botón no hacía nada y
// la persona lo volvía a presionar. Mientras la acción corre, el botón
// queda desactivado y dice qué está pasando. La acción termina con un
// redirect, que también cierra la transición.
export function FormActualizar({ children }: { children: React.ReactNode }) {
  const [actualizando, startTransition] = useTransition();

  function enviar(evento: React.FormEvent<HTMLFormElement>) {
    evento.preventDefault();
    if (actualizando) return;
    const datos = new FormData(evento.currentTarget);
    startTransition(async () => {
      await actualizarPublicidadAction(datos);
    });
  }

  return (
    <form onSubmit={enviar} className={styles.formActualizar} aria-busy={actualizando}>
      {children}
      <Boton type="submit" disabled={actualizando}>
        {actualizando ? "Actualizando…" : "Actualizar ahora"}
      </Boton>
      {actualizando ? (
        <span className={styles.notaActualizando} role="status">
          Puede tardar unos minutos. No cierres esta página.
        </span>
      ) : null}
    </form>
  );
}
