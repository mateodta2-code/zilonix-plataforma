"use client";

import { useFormStatus } from "react-dom";
import { BarraCarga } from "@/components/marco/BarraCarga";
import { clasesBoton } from "@/components/marco/Boton";
import styles from "./page.module.css";

// useFormStatus solo funciona en un componente HIJO del <form>.
function Contenido() {
  const { pending } = useFormStatus();
  return (
    <>
      <button type="submit" className={clasesBoton("primario")} disabled={pending}>
        Sincronizar pedidos (últimos 60 días)
      </button>
      {pending && (
        <BarraCarga
          estado="cargando"
          titulo="Trayendo pedidos de Falabella de los últimos 60 días…"
          avance={null}
          sticky={false}
          ariaLabel="Trayendo pedidos de Falabella"
        />
      )}
    </>
  );
}

// La server action (y sus redirects) llega ya enlazada desde la página: acá
// no se cambia, solo se muestra el estado mientras el formulario se envía.
export function FormularioSincronizarFalabella({ accion }: { accion: () => void | Promise<void> }) {
  return (
    <form action={accion} className={styles.formSincronizar}>
      <Contenido />
    </form>
  );
}
