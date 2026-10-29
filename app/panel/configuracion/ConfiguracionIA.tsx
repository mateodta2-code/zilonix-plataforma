"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Boton } from "@/components/marco/Boton";
import { Campo } from "@/components/marco/Campo";
import { Chip } from "@/components/marco/Chip";
import { Tarjeta } from "@/components/marco/Tarjeta";
import styles from "./configuracion.module.css";

type Proveedor = "anthropic" | "openai" | "google" | "xai" | "otro_compatible_openai";
type ConexionIA = { id: string; proveedor: Proveedor; baseUrl: string | null; modelo: string; actualizadoTs: string };

const ETIQUETA_PROVEEDOR: Record<Proveedor, string> = {
  anthropic: "Anthropic (Claude)",
  openai: "OpenAI",
  google: "Google (Gemini)",
  xai: "xAI (Grok)",
  otro_compatible_openai: "Otro compatible con OpenAI",
};

// Rama feat-promociones, punto 6 — "Conexión de IA" por empresa. La
// API key nunca llega acá ya cargada (el servidor solo manda
// metadatos, nunca la key descifrada — ver lib/ia/conexion.ts) ni se
// vuelve a mostrar después de guardarla: el campo siempre arranca
// vacío, "escribir una nueva la reemplaza" es la única forma de
// cambiarla.
export function ConfiguracionIA({ conexionInicial, puedeModificar }: { conexionInicial: ConexionIA | null; puedeModificar: boolean }) {
  const router = useRouter();
  const [conexion, setConexion] = useState(conexionInicial);
  const [proveedor, setProveedor] = useState<Proveedor>(conexionInicial?.proveedor ?? "anthropic");
  const [modelo, setModelo] = useState(conexionInicial?.modelo ?? "");
  const [baseUrl, setBaseUrl] = useState(conexionInicial?.baseUrl ?? "");
  const [apiKey, setApiKey] = useState("");
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState("");

  async function guardar(e: React.FormEvent) {
    e.preventDefault();
    setGuardando(true);
    setError("");
    const res = await fetch("/api/configuracion/ia-conexion", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ proveedor, modelo, baseUrl: baseUrl || null, apiKey }),
    });
    setGuardando(false);
    if (res.ok) {
      setApiKey("");
      router.refresh();
    } else {
      const data = await res.json().catch(() => ({}));
      setError(data.error || "No se pudo guardar.");
    }
  }

  async function desconectar() {
    if (!confirm("¿Desconectar la IA de esta empresa? Los módulos que la usan (como Promociones) van a seguir funcionando solo con los números.")) return;
    setGuardando(true);
    const res = await fetch("/api/configuracion/ia-conexion", { method: "DELETE" });
    setGuardando(false);
    if (res.ok) {
      setConexion(null);
      router.refresh();
    }
  }

  return (
    <Tarjeta className={styles.seccion}>
      <p className="zx-etiqueta">CONEXIÓN DE IA</p>
      <p style={{ fontSize: 13, color: "var(--text-muted)", marginTop: 8 }}>
        Conectá un proveedor de IA para que módulos como Promociones puedan explicar y resumir en español — los números siempre los calcula el
        motor de reglas, nunca la IA. Sin conexión, esos módulos funcionan igual.
      </p>

      {conexion && (
        <div className={styles.estadoActual}>
          <Chip estado="exito">Conectado</Chip>
          <span>
            {ETIQUETA_PROVEEDOR[conexion.proveedor]} — modelo <code>{conexion.modelo}</code>
          </span>
        </div>
      )}

      {puedeModificar ? (
        <form onSubmit={guardar} className={styles.formulario}>
          <Campo etiqueta="Proveedor">
            <select className="zx-control" value={proveedor} onChange={(e) => setProveedor(e.target.value as Proveedor)}>
              {Object.entries(ETIQUETA_PROVEEDOR).map(([valor, etiqueta]) => (
                <option key={valor} value={valor}>
                  {etiqueta}
                </option>
              ))}
            </select>
          </Campo>
          <Campo etiqueta="Modelo">
            <input className="zx-control" value={modelo} onChange={(e) => setModelo(e.target.value)} placeholder="ej. claude-sonnet-5" required />
          </Campo>
          {proveedor === "otro_compatible_openai" && (
            <Campo etiqueta="URL base (compatible con OpenAI)">
              <input className="zx-control" value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} placeholder="https://..." required />
            </Campo>
          )}
          <Campo etiqueta={conexion ? "Nueva API key (dejar vacío para no cambiarla)" : "API key"}>
            <input className="zx-control" type="password" value={apiKey} onChange={(e) => setApiKey(e.target.value)} autoComplete="off" />
          </Campo>
          {error && <p style={{ color: "var(--kpi-peligro-texto)", fontSize: 13 }}>{error}</p>}
          <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
            <Boton type="submit" variante="primario" chico disabled={guardando || !modelo.trim() || !apiKey.trim()}>
              {guardando ? "Guardando…" : "Guardar conexión"}
            </Boton>
            {conexion && (
              <Boton type="button" variante="secundario" chico disabled={guardando} onClick={desconectar}>
                Desconectar
              </Boton>
            )}
          </div>
        </form>
      ) : (
        <p style={{ fontSize: 13, color: "var(--text-faint)", marginTop: 10 }}>No tenés permiso para cambiar esta conexión.</p>
      )}
    </Tarjeta>
  );
}
