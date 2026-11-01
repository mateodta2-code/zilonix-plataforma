"use client";

import { useState } from "react";
import { Boton } from "@/components/marco/Boton";
import { Campo } from "@/components/marco/Campo";
import type { Cuenta } from "../CuentasDestino";
import { buscarImportacionPorSkuAction } from "./actions";
import styles from "../publicar.module.css";

// Parte 3, punto A.1 — "Importar publicación por SKU": mismo patrón de
// checkboxes + "buscar en las cuentas elegidas" que ya usa Clip
// (SeccionClip.tsx) — nunca se inventa otro endpoint de búsqueda, la
// Server Action reusa buscarItemPorSku (lib/ml/clip.ts) tal cual.
export function ImportarPorSku({
  cuentas,
  skuNoEncontrado,
  importado,
}: {
  cuentas: Cuenta[];
  skuNoEncontrado: string;
  importado: boolean;
}) {
  const [cuentasElegidas, setCuentasElegidas] = useState<Record<string, boolean>>({});

  return (
    <>
      <p style={{ fontSize: 13, color: "var(--texto-suave)" }}>
        Traé los datos de una publicación propia que ya existe (título, precio, stock, fotos, SKU) para reutilizarla como base de una nueva —
        todavía no publica nada, solo precarga el formulario de arriba.
      </p>
      <form action={buscarImportacionPorSkuAction} style={{ marginTop: 12 }}>
        <p className="zx-etiqueta" style={{ fontSize: 11 }}>
          Cuentas donde buscar el SKU
        </p>
        <div style={{ marginTop: 6, marginBottom: 10 }}>
          {cuentas.map((c) => (
            <label key={c.id} className={`${styles.recuadroMarca} ${styles.filaCuenta}`} style={{ fontSize: 14, cursor: "pointer" }}>
              <input
                type="checkbox"
                name="cuentaId"
                value={c.id}
                checked={Boolean(cuentasElegidas[c.id])}
                onChange={(e) => setCuentasElegidas((actual) => ({ ...actual, [c.id]: e.target.checked }))}
              />
              {c.nickname}
            </label>
          ))}
          {cuentas.length === 0 && <p style={{ fontSize: 13, color: "var(--texto-suave)" }}>No hay ninguna cuenta conectada todavía.</p>}
        </div>
        <Campo etiqueta="SKU propio ya publicado">
          <input name="sku" defaultValue={skuNoEncontrado} required className="zx-control" />
        </Campo>
        <Boton type="submit" variante="secundario" chico style={{ marginTop: 8 }} disabled={cuentas.length === 0}>
          Buscar SKU en las cuentas elegidas
        </Boton>
      </form>

      {skuNoEncontrado && !importado && (
        <p style={{ marginTop: 12, color: "var(--kpi-peligro-texto)", fontSize: 14 }}>No se encontró ninguna publicación con el SKU "{skuNoEncontrado}" en las cuentas elegidas.</p>
      )}
      {importado && <p style={{ marginTop: 12, color: "var(--kpi-exito-texto)", fontSize: 14 }}>Se importó — revisá el formulario de arriba.</p>}
    </>
  );
}
