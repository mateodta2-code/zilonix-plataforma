"use client";

import { useEffect, useState } from "react";
import { Boton } from "@/components/marco/Boton";
import { historialProductoAction } from "@/app/panel/inventario/actions";
import type { FilaHistorialProducto } from "@/lib/inventario/vista-inventario";
import { ModalInventario } from "./ModalInventario";
import styles from "./ModalInventario.module.css";

// Issue #280 — «Historial ingresos» de cada fila (copia del pantallazo
// de Zilonix OS): entradas, salidas y el resto de movimientos del SKU
// en ESA bodega, lo más reciente primero. Se carga al abrir (solo
// lectura, inventario.consultar); «Ver más» hasta el tope de 100.
export function ModalHistorialProducto({
  skuId,
  bodegaId,
  nombre,
  codigo,
  onCerrar,
}: {
  skuId: string;
  bodegaId: string | null;
  nombre: string;
  codigo: string;
  onCerrar: () => void;
}) {
  const [pagina, setPagina] = useState(1);
  const [estado, setEstado] = useState<
    { tipo: "cargando" } | { tipo: "error"; mensaje: string } | { tipo: "listo"; filas: FilaHistorialProducto[]; hayMas: boolean }
  >({ tipo: "cargando" });
  const [cargandoMas, setCargandoMas] = useState(false);

  useEffect(() => {
    let vigente = true;
    setCargandoMas(true);
    historialProductoAction(skuId, bodegaId, pagina)
      .then((r) => {
        if (!vigente) return;
        setEstado(r.ok ? { tipo: "listo", filas: r.filas, hayMas: r.hayMas } : { tipo: "error", mensaje: r.mensaje });
      })
      .catch(() => vigente && setEstado({ tipo: "error", mensaje: "No se pudo cargar el historial. Intenta de nuevo." }))
      .finally(() => vigente && setCargandoMas(false));
    return () => {
      vigente = false;
    };
  }, [skuId, bodegaId, pagina]);

  return (
    <ModalInventario titulo="Historial del producto" subtitulo={`${nombre} · ${codigo}`} icono={<IconoReloj />} onCerrar={onCerrar}>
      {estado.tipo === "cargando" && <p className={styles.cargando}>Cargando…</p>}
      {estado.tipo === "error" && <p className={styles.avisoError}>{estado.mensaje}</p>}
      {estado.tipo === "listo" && estado.filas.length === 0 && (
        <p className={styles.vacio}>{bodegaId ? "Todavía no hay movimientos de este producto en esta bodega." : "Todavía no hay movimientos de este producto."}</p>
      )}
      {estado.tipo === "listo" && estado.filas.length > 0 && (
        <>
          <table className={styles.tablaHistorial}>
            <thead>
              <tr>
                <th>Fecha</th>
                <th>Usuario</th>
                <th>Stock</th>
                <th>Detalle</th>
              </tr>
            </thead>
            <tbody>
              {estado.filas.map((f) => (
                <tr key={f.id}>
                  <td className={styles.fecha}>{f.fecha}</td>
                  <td>{f.usuario}</td>
                  <td className={styles.stock}>
                    {f.cambio === "sin_cambio" ? (
                      <span className={styles.sinCambio}>{f.despues} (sin cambio)</span>
                    ) : (
                      <>
                        {f.antes} → <span className={f.cambio === "sube" ? styles.sube : styles.baja}>{f.despues}</span>
                      </>
                    )}
                  </td>
                  <td>{f.detalle}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {estado.hayMas && (
            <div className={styles.verMas}>
              <Boton type="button" variante="secundario" chico disabled={cargandoMas} onClick={() => setPagina((p) => p + 1)}>
                {cargandoMas ? "Cargando…" : "Ver más"}
              </Boton>
            </div>
          )}
        </>
      )}
    </ModalInventario>
  );
}

function IconoReloj() {
  return (
    <svg className={styles.icono} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 2" />
    </svg>
  );
}
