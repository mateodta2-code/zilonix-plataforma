"use client";

import { useState } from "react";
import { Boton } from "@/components/marco/Boton";
import { Campo } from "@/components/marco/Campo";
import { Tarjeta } from "@/components/marco/Tarjeta";
import { buscarItemAction, cambiarEstadoAction } from "./clip/actions";
import { mensajeErrorClip } from "./clip/mensajes-error";
import type { Cuenta } from "./CuentasDestino";
import styles from "./publicar.module.css";

export type ItemClip = { itemId: string; titulo: string; thumbnail: string | null } | null;
export type PrefillClip = { cuentaId: string; sku: string; itemId: string; clipSubido: boolean; error: string };

// Punto 9 del pedido — "Publicar clip (video) al final, solo si
// CLIP_HABILITADO === 'true'". `cambiarEstadoAction`/`buscarItemAction`
// (clip/actions.ts) y la subida (app/api/ml/clip/route.ts) ya chequean
// la bandera por su cuenta — este componente ni se renderiza si está
// apagada (PaginaPublicar.tsx decide eso), nunca depende solo de que
// esta UI esté oculta.
export function SeccionClip({ cuentas, item, prefillClip }: { cuentas: Cuenta[]; item: ItemClip; prefillClip: PrefillClip }) {
  const [cuentasElegidas, setCuentasElegidas] = useState<Record<string, boolean>>(() => (prefillClip.cuentaId ? { [prefillClip.cuentaId]: true } : {}));
  const cuentaEncontrada = cuentas.find((c) => c.id === prefillClip.cuentaId);
  const mensajeError = mensajeErrorClip(prefillClip.error || undefined);

  return (
    <Tarjeta className={styles.seccion}>
      <div id="clip" />
      <p className="zx-etiqueta">Publicar clip (video)</p>
      <p style={{ fontSize: 13, color: "var(--texto-suave)", marginTop: 8 }}>
        Requisitos reales de Mercado Libre: 10–61 segundos, vertical, máx. 280MB, formato MP4/MOV/MPEG/AVI. Mercado Libre modera el video
        (24–48h) antes de que quede visible — esto solo confirma que quedó recibido.
      </p>

      <form action={buscarItemAction} style={{ marginTop: 14 }}>
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
        </div>
        <Campo etiqueta="SKU de la publicación ya existente">
          <input name="sku" defaultValue={prefillClip.sku} required className="zx-control" />
        </Campo>
        <Boton type="submit" variante="secundario" chico style={{ marginTop: 8 }}>
          Buscar SKU en las cuentas elegidas
        </Boton>
      </form>

      {prefillClip.sku && !item && (
        <p style={{ marginTop: 14, color: "var(--kpi-peligro-texto)", fontSize: 14 }}>No se encontró ninguna publicación con ese SKU en las cuentas elegidas.</p>
      )}

      {/* app/api/ml/clip/route.ts vuelve con ?error= en varios casos
      (sin permiso, datos faltantes) donde cuentaId/itemId podrían no
      resolver a un item real — el aviso tiene que verse igual, no
      depender de eso. mensajeErrorClip() nunca devuelve el valor
      crudo de la URL: solo el texto fijo del código, o el genérico si
      no lo reconoce. */}
      {mensajeError && <p style={{ marginTop: 14, color: "var(--kpi-peligro-texto)", fontSize: 14 }}>{mensajeError}</p>}

      {item && cuentaEncontrada && (
        <div className={`${styles.recuadroMarca} ${styles.seccion}`} style={{ padding: 14 }}>
          <p style={{ fontSize: 14 }}>
            <strong>{item.titulo}</strong> ({item.itemId})
          </p>
          {prefillClip.clipSubido && <p style={{ color: "var(--kpi-exito-texto)", fontSize: 13 }}>Clip subido — queda en moderación 24-48h.</p>}

          {/* Issue real (tarea 2.11): next.config.mjs limita el body de
          toda Server Action a 6MB (pensado para el CSV de SKU), y un
          Clip real llega hasta 280MB. Por eso esto NO es una Server
          Action: es un <form> normal que postea directo a un Route
          Handler (app/api/ml/clip/route.ts), que no tiene ese tope. */}
          <form action="/api/ml/clip" method="post" encType="multipart/form-data" style={{ marginTop: 12 }}>
            <input type="hidden" name="cuentaId" value={cuentaEncontrada.id} />
            <input type="hidden" name="itemId" value={item.itemId} />
            <Campo etiqueta="Video (MP4/MOV/MPEG/AVI, 10-61 segundos, vertical, máx. 280MB)">
              <input type="file" name="archivo" accept="video/mp4,video/quicktime,video/mpeg,video/x-msvideo" required className="zx-control" />
            </Campo>
            <Boton type="submit" variante="secundario" chico style={{ marginTop: 8 }}>
              Subir Clip
            </Boton>
          </form>

          <form action={cambiarEstadoAction} style={{ marginTop: 14, display: "flex", gap: 8 }}>
            <input type="hidden" name="cuentaId" value={cuentaEncontrada.id} />
            <input type="hidden" name="itemId" value={item.itemId} />
            <Boton type="submit" variante="secundario" chico name="activar" value="0">
              Pausar publicación
            </Boton>
            <Boton type="submit" variante="secundario" chico name="activar" value="1">
              Activar publicación
            </Boton>
          </form>
        </div>
      )}
    </Tarjeta>
  );
}
