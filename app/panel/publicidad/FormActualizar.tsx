"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Boton } from "@/components/marco/Boton";
import { actualizarPublicidadAction } from "./actions";
import styles from "./page.module.css";

// Si la respuesta nunca llega (se cortó la conexión a los varios
// minutos), el servidor igual pudo terminar: no se afirma que falló.
const AVISO_SIN_RESPUESTA =
  "No llegó la respuesta del servidor. La actualización puede seguir corriendo: recargá la página en unos minutos.";

// "Actualizar ahora" puede tardar hasta 4 minutos (el mismo presupuesto
// de 240 s que el cron). Mientras corre, el botón queda desactivado y
// dice qué está pasando. Al terminar muestra el aviso que devuelve la
// acción y refresca los datos de la pantalla (router.refresh). No
// depende de una redirección: en staging el aviso no aparecía (14-nov).
export function FormActualizar({ cuentaMlId }: { cuentaMlId: string }) {
  const router = useRouter();
  const [actualizando, startTransition] = useTransition();
  const [aviso, setAviso] = useState<{ ok: boolean; texto: string } | null>(null);

  function enviar(evento: React.FormEvent<HTMLFormElement>) {
    evento.preventDefault();
    if (actualizando) return;
    const datos = new FormData(evento.currentTarget);
    setAviso(null);
    startTransition(async () => {
      try {
        const resultado = await actualizarPublicidadAction(datos);
        setAviso({ ok: resultado.ok, texto: resultado.aviso });
        router.refresh();
      } catch {
        setAviso({ ok: false, texto: AVISO_SIN_RESPUESTA });
      }
    });
  }

  return (
    <form onSubmit={enviar} className={styles.formActualizar} aria-busy={actualizando}>
      <input type="hidden" name="cuentaMlId" value={cuentaMlId} />
      <Boton type="submit" disabled={actualizando}>
        {actualizando ? "Actualizando…" : "Actualizar ahora"}
      </Boton>
      {actualizando ? (
        <span className={styles.notaActualizando} role="status">
          Puede tardar unos minutos. No cierres esta página.
        </span>
      ) : aviso ? (
        <span className={aviso.ok ? styles.avisoActualizarOk : styles.avisoActualizarError} role="status">
          {aviso.texto}
        </span>
      ) : null}
    </form>
  );
}
