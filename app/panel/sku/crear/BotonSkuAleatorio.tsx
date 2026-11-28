"use client";

import { useState } from "react";
import { Boton } from "@/components/marco/Boton";
import { sugerirSkuAleatorioAction } from "./actions";
import styles from "./page.module.css";

// Rellena el campo SKU con el siguiente código libre (FUL + 3 letras +
// 4 números). Solo sugiere: si no se pulsa, el servidor lo genera igual
// al guardar con el campo vacío.
export function BotonSkuAleatorio() {
  const [cargando, setCargando] = useState(false);
  const [aviso, setAviso] = useState<string | null>(null);

  async function alPulsar(evento: React.MouseEvent<HTMLButtonElement>) {
    const form = evento.currentTarget.form;
    if (!form) return;
    const nombre = (form.elements.namedItem("nombre") as HTMLInputElement | null)?.value ?? "";
    const campoSku = form.elements.namedItem("sku") as HTMLInputElement | null;
    setCargando(true);
    setAviso(null);
    try {
      const respuesta = await sugerirSkuAleatorioAction(nombre);
      if (respuesta.ok && campoSku) campoSku.value = respuesta.codigo;
      else if (!respuesta.ok) setAviso(respuesta.mensaje);
    } finally {
      setCargando(false);
    }
  }

  return (
    <>
      <Boton type="button" variante="secundario" chico onClick={alPulsar} disabled={cargando}>
        {cargando ? "Buscando…" : "SKU aleatorio"}
      </Boton>
      {aviso && <span className={styles.error}>{aviso}</span>}
    </>
  );
}
