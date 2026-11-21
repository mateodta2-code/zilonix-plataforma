"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Boton } from "@/components/marco/Boton";
import { guardarMetaMargenAction } from "./actions";
import styles from "./page.module.css";

// Semáforo de productos (16-nov). Explica las franjas y, si el rol
// puede modificar Publicidad, deja cambiar la meta. Las franjas se
// recalculan solas: verde desde la meta, amarillo desde la mitad.
export function MetaMargen({
  meta,
  mitad,
  valor,
  puedeEditar,
}: {
  meta: string;
  mitad: string;
  valor: string;
  puedeEditar: boolean;
}) {
  const router = useRouter();
  const [guardando, startTransition] = useTransition();
  const [aviso, setAviso] = useState<{ ok: boolean; texto: string } | null>(null);

  function enviar(evento: React.FormEvent<HTMLFormElement>) {
    evento.preventDefault();
    if (guardando) return;
    const datos = new FormData(evento.currentTarget);
    setAviso(null);
    startTransition(async () => {
      try {
        const resultado = await guardarMetaMargenAction(datos);
        setAviso({ ok: resultado.ok, texto: resultado.aviso });
        if (resultado.ok) router.refresh();
      } catch {
        setAviso({ ok: false, texto: "No se pudo guardar la meta. Probá de nuevo en un momento." });
      }
    });
  }

  return (
    <section className={styles.panelDatos} aria-label="Semáforo de productos">
      <p className={styles.seccion}>Semáforo de productos</p>
      <p className={styles.nota}>
        Columna Margen de los anuncios: ganancia real por unidad sobre el precio de venta actual (con promoción si la hay), menos
        costo, empaque, envío a agencia, comisión de Mercado Libre y envío de Mercado Libre cuando lo paga el vendedor. Verde
        desde {meta}, amarillo entre {mitad} y {meta}, rojo bajo {mitad}. El costo sale de la tabla de costos de Finanzas.
      </p>
      {puedeEditar ? (
        <form onSubmit={enviar} className={styles.formActualizar} aria-busy={guardando}>
          <label className={styles.campo}>
            <span className="zx-etiqueta">Meta de margen (%)</span>
            <input name="meta" className="zx-control" inputMode="decimal" defaultValue={valor} size={5} required />
          </label>
          <Boton type="submit" variante="primario" disabled={guardando}>
            {guardando ? "Guardando…" : "Guardar meta"}
          </Boton>
          {aviso ? (
            <span className={aviso.ok ? styles.avisoActualizarOk : styles.avisoActualizarError} role="status">
              {aviso.texto}
            </span>
          ) : null}
        </form>
      ) : null}
    </section>
  );
}
