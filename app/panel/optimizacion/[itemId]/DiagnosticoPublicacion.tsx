"use client";

import { useState, useTransition } from "react";
import { Boton } from "@/components/marco/Boton";
import { BarraCarga } from "@/components/marco/BarraCarga";
import { diagnosticoPublicacionAction } from "../actions";
import styles from "../page.module.css";

// Solo administradores (la página no lo muestra a nadie más y la acción
// vuelve a revisar el permiso). Solo lectura: consulta Mercado Libre y
// muestra el resultado para copiarlo a soporte.
export function DiagnosticoPublicacion({ cuentaMlId, itemId }: { cuentaMlId: string; itemId: string }) {
  const [enviando, iniciar] = useTransition();
  const [lineas, setLineas] = useState<string[] | null>(null);
  const [aviso, setAviso] = useState("");
  const [copiado, setCopiado] = useState(false);

  const consultar = () =>
    iniciar(async () => {
      setAviso("");
      setCopiado(false);
      const r = await diagnosticoPublicacionAction({ cuentaMlId, itemId });
      if (r.ok) setLineas(r.lineas);
      else {
        setLineas(null);
        setAviso(r.aviso);
      }
    });

  const copiar = async () => {
    if (!lineas) return;
    try {
      await navigator.clipboard.writeText(lineas.join("\n"));
      setCopiado(true);
    } catch {
      setAviso("No se pudo copiar. Selecciona el texto y cópialo a mano.");
    }
  };

  return (
    <div className={styles.edicion}>
      <p className={styles.nota}>
        Solo lectura: consulta cómo devuelve Mercado Libre esta publicación (título, familia y precio) para que soporte encuentre por qué un cambio no se
        aplica. No guarda ni cambia nada.
      </p>
      <div className={styles.iaAcciones}>
        <Boton type="button" variante="secundario" onClick={consultar} disabled={enviando}>
          {enviando ? "Consultando…" : "Ver diagnóstico"}
        </Boton>
        {lineas ? (
          <Boton type="button" variante="fantasma" onClick={copiar}>
            {copiado ? "Copiado" : "Copiar"}
          </Boton>
        ) : null}
      </div>
      <BarraCarga sticky={false} estado={enviando ? "cargando" : "inactiva"} titulo="Consultando diagnóstico…" ariaLabel="Progreso del diagnóstico" />
      {aviso ? (
        <p className={styles.avisoError} role="status">
          {aviso}
        </p>
      ) : null}
      {lineas ? <pre className={styles.diagnostico}>{lineas.join("\n")}</pre> : null}
    </div>
  );
}
