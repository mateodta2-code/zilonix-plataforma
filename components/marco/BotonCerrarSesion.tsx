"use client";

import { useClerk } from "@clerk/nextjs";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { IconoCerrarSesion } from "./iconos";
import styles from "./BotonCerrarSesion.module.css";

// Dos sitios lo usan (BarraSuperior, dentro de /panel, y la página de
// /cuenta) con el mismo signOut de Clerk — variante solo cambia el
// color de reposo porque cada uno cae sobre un fondo distinto (ver
// BotonCerrarSesion.module.css).
export function BotonCerrarSesion({ variante = "barra" }: { variante?: "barra" | "cuenta" }) {
  const { signOut } = useClerk();
  const router = useRouter();
  const [saliendo, setSaliendo] = useState(false);

  async function manejarClic() {
    if (saliendo) return;
    setSaliendo(true);
    await signOut({ redirectUrl: "/" });
    router.push("/");
  }

  return (
    <button
      type="button"
      onClick={manejarClic}
      disabled={saliendo}
      className={`${styles.boton} ${variante === "cuenta" ? styles.cuenta : styles.barra}`}
      title="Cerrar sesión"
    >
      <IconoCerrarSesion size={16} />
      <span>{saliendo ? "Saliendo…" : "Cerrar sesión"}</span>
    </button>
  );
}
