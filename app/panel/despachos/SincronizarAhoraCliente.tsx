"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { BarraCarga } from "@/components/marco/BarraCarga";
import { Boton } from "@/components/marco/Boton";
import { sincronizarAhoraAction } from "./actions";
import styles from "./page.module.css";

// Issue "pendientes no muestra venta nueva" — botón pedido por Mateo:
// trae las ventas nuevas de Mercado Libre al instante desde Pendientes
// (reusa traerVentasDelMes, la misma función de Finanzas → "Traer
// ventas de este mes"), sin tener que ir a otra pantalla. router.refresh()
// después de un éxito: el resumen que devuelve la acción ya refleja lo
// recién sincronizado, pero las TARJETAS de esta página se piden de
// nuevo (revalidatePath, dentro de la acción, no alcanza solo con eso
// en un Server Component ya renderizado del lado del cliente).
export function SincronizarAhoraCliente() {
  const router = useRouter();
  const [enCurso, setEnCurso] = useState(false);
  const [mensaje, setMensaje] = useState<string | null>(null);
  const [esError, setEsError] = useState(false);

  async function sincronizar() {
    setEnCurso(true);
    setMensaje(null);
    const resultado = await sincronizarAhoraAction();
    setEnCurso(false);
    setEsError(!resultado.ok);
    setMensaje(resultado.ok ? resultado.resumen : resultado.error);
    if (resultado.ok) router.refresh();
  }

  return (
    <div className={styles.sincronizarAhora}>
      <Boton variante="primario" type="button" onClick={sincronizar} disabled={enCurso}>
        {enCurso ? "Sincronizando…" : "Sincronizar ahora"}
      </Boton>
      {/* Barra azul (Barra-B): animada mientras corre; al terminar bien queda
          «completa» ~4 s y luego deja el resumen. El error sigue como antes. */}
      <BarraCarga
        estado={enCurso ? "cargando" : mensaje && !esError ? "completa" : "inactiva"}
        titulo="Sincronizando ventas de Mercado Libre…"
        avance={null}
        textoCompleta={mensaje ?? undefined}
        textoInactiva={mensaje && !esError ? mensaje : undefined}
        sticky={false}
        ariaLabel="Sincronizando ventas de Mercado Libre"
      />
      {mensaje && esError && <p className={styles.errorTarjeta}>{mensaje}</p>}
    </div>
  );
}
