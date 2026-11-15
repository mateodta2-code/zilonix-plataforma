"use client";

import { useEffect, useState } from "react";
import { clasesBoton } from "@/components/marco/Boton";

// Widget chico, autónomo (se fija su propio estado al montar) — vive
// en Publicar en vez de Configuración, a propósito: Configuración
// exige el módulo "configuracion" para ni siquiera ver la pantalla,
// pero un rol como Auxiliar u Operador (plantillas de lib/roles-plantillas.ts)
// puede publicar (módulo "inventario") sin tener ese permiso — el
// botón tiene que estar donde la persona que de verdad lo necesita
// pueda verlo.
export function ConectarCanva() {
  const [estado, setEstado] = useState<"cargando" | "conectado" | "desconectado">("cargando");
  const [desconectando, setDesconectando] = useState(false);

  useEffect(() => {
    let cancelado = false;
    fetch("/api/canva/estado")
      .then((res) => (res.ok ? res.json() : null))
      .then((data: { conectado?: boolean } | null) => {
        if (!cancelado) setEstado(data?.conectado ? "conectado" : "desconectado");
      })
      .catch(() => {
        if (!cancelado) setEstado("desconectado");
      });
    return () => {
      cancelado = true;
    };
  }, []);

  async function desconectar() {
    if (!confirm("¿Desconectar tu Canva? Vas a tener que volver a conectarla para traer diseños acá.")) return;
    setDesconectando(true);
    const res = await fetch("/api/canva/desconectar", { method: "POST" });
    setDesconectando(false);
    if (res.ok) setEstado("desconectado");
  }

  if (estado === "cargando") return null;

  if (estado === "conectado") {
    return (
      <span style={{ fontSize: 11, color: "var(--text-muted)" }}>
        Canva conectado —{" "}
        <button
          type="button"
          onClick={desconectar}
          disabled={desconectando}
          style={{ background: "none", border: "none", padding: 0, color: "inherit", textDecoration: "underline", cursor: "pointer", fontSize: 11 }}
        >
          {desconectando ? "desconectando…" : "desconectar"}
        </button>
      </span>
    );
  }

  return (
    <a href="/api/canva/conectar" className={clasesBoton("secundario", true)} style={{ fontSize: 11 }}>
      Conectar Canva
    </a>
  );
}
