"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Boton } from "@/components/marco/Boton";
import { Campo } from "@/components/marco/Campo";
import { editarDatosProductoAction, moverStockProductoAction, type ResultadoModal } from "@/app/panel/inventario/actions";
import { ModalInventario } from "./ModalInventario";
import styles from "./ModalInventario.module.css";

export type BodegaModal = { id: string; nombre: string; esPrincipal: boolean };

// Issue #280 — «Modificar» de cada fila: (1) ingreso o salida de stock
// (vía aplicarMovimientos, nota obligatoria; nunca en un kit) y (2)
// nombre, costo y precio. El CÓDIGO del SKU no se edita acá.
export function ModalModificarProducto({
  skuId,
  codigo,
  nombre,
  esKit,
  bodegaId,
  bodegas,
  costo,
  precioVenta,
  veCostos,
  cambiaCostos,
  onCerrar,
}: {
  skuId: string;
  codigo: string;
  nombre: string;
  esKit: boolean;
  bodegaId: string | null;
  bodegas: BodegaModal[];
  costo: string | null;
  precioVenta: string | null;
  // finanzas.consultar / finanzas.modificar del rol (la acción lo
  // vuelve a revisar: esto solo decide qué se pinta).
  veCostos: boolean;
  cambiaCostos: boolean;
  onCerrar: () => void;
}) {
  const router = useRouter();
  const [pendiente, iniciar] = useTransition();
  // Un id por apertura: un doble clic manda el mismo y no duplica. Se
  // renueva solo después de un movimiento aplicado.
  const [operacionId, setOperacionId] = useState(() => crypto.randomUUID());
  const [avisoStock, setAvisoStock] = useState<ResultadoModal | null>(null);
  const [avisoDatos, setAvisoDatos] = useState<ResultadoModal | null>(null);
  const bodegaInicial = bodegas.find((b) => b.id === bodegaId)?.id ?? bodegas.find((b) => b.esPrincipal)?.id ?? bodegas[0]?.id ?? "";

  function enviarStock(formData: FormData) {
    iniciar(async () => {
      const r = await moverStockProductoAction(formData);
      setAvisoStock(r);
      if (r.ok) {
        setOperacionId(crypto.randomUUID());
        router.refresh();
      }
    });
  }

  function enviarDatos(formData: FormData) {
    iniciar(async () => {
      const r = await editarDatosProductoAction(formData);
      setAvisoDatos(r);
      if (r.ok) router.refresh();
    });
  }

  return (
    <ModalInventario titulo="Modificar producto" subtitulo={`${nombre} · ${codigo}`} onCerrar={onCerrar}>
      {!esKit && (
        <section className={styles.seccion}>
          <h3 className={styles.tituloSeccion}>Ingreso o salida de stock</h3>
          {avisoStock && <p className={avisoStock.ok ? styles.avisoOk : styles.avisoError}>{avisoStock.mensaje}</p>}
          {bodegas.length === 0 ? (
            <p className={styles.nota}>Para mover stock primero crea una bodega activa.</p>
          ) : (
            <form action={enviarStock}>
              <input type="hidden" name="skuId" value={skuId} />
              <input type="hidden" name="operacionId" value={operacionId} />
              <div className={styles.grid}>
                <Campo etiqueta="Tipo">
                  <select name="tipo" required defaultValue="entrada" className="zx-control">
                    <option value="entrada">Ingreso</option>
                    <option value="salida">Salida</option>
                  </select>
                </Campo>
                <Campo etiqueta="Bodega">
                  <select name="bodegaId" required defaultValue={bodegaInicial} className="zx-control">
                    {bodegas.map((b) => (
                      <option key={b.id} value={b.id}>
                        {b.nombre}
                      </option>
                    ))}
                  </select>
                </Campo>
                <Campo etiqueta="Cantidad">
                  <input name="cantidad" type="number" min={1} step={1} required className="zx-control" />
                </Campo>
                <Campo etiqueta="Nota">
                  <input name="nota" required maxLength={200} placeholder="Conteo, compra, daño…" className="zx-control" />
                </Campo>
              </div>
              <div className={styles.acciones}>
                <Boton type="submit" disabled={pendiente}>
                  Registrar movimiento
                </Boton>
              </div>
            </form>
          )}
        </section>
      )}

      <section className={styles.seccion}>
        <h3 className={styles.tituloSeccion}>Datos del producto</h3>
        {avisoDatos && <p className={avisoDatos.ok ? styles.avisoOk : styles.avisoError}>{avisoDatos.mensaje}</p>}
        <form action={enviarDatos}>
          <input type="hidden" name="skuId" value={skuId} />
          <div className={styles.grid}>
            <div className={styles.ancho}>
              <Campo etiqueta="Nombre">
                {esKit ? (
                  <input value={nombre} readOnly disabled className="zx-control" />
                ) : (
                  <input name="nombre" required maxLength={200} defaultValue={nombre} className="zx-control" />
                )}
              </Campo>
            </div>
            <div className={styles.ancho}>
              <Campo etiqueta="Código (SKU)">
                <input value={codigo} readOnly disabled className="zx-control" />
              </Campo>
            </div>
            {veCostos && cambiaCostos && (
              <>
                <Campo etiqueta="Costo inicial">
                  <input name="costo" inputMode="decimal" defaultValue={costo ?? ""} placeholder="Vacío = sin dato" className="zx-control" />
                </Campo>
                <Campo etiqueta="Precio de venta">
                  <input name="precioVenta" inputMode="decimal" defaultValue={precioVenta ?? ""} placeholder="Vacío = sin dato" className="zx-control" />
                </Campo>
              </>
            )}
            {veCostos && !cambiaCostos && (
              <>
                <Campo etiqueta="Costo inicial">
                  <input value={costo ?? "—"} readOnly disabled className={`zx-control ${styles.soloLectura}`} />
                </Campo>
                <Campo etiqueta="Precio de venta">
                  <input value={precioVenta ?? "—"} readOnly disabled className={`zx-control ${styles.soloLectura}`} />
                </Campo>
              </>
            )}
          </div>
          {veCostos && !cambiaCostos && <p className={styles.nota}>Tu rol puede ver el costo y el precio, pero no cambiarlos.</p>}
          {esKit && <p className={styles.nota}>El nombre de un kit se cambia en la pantalla de SKU.</p>}
          <p className={styles.nota}>La categoría se podrá editar después de la migración.</p>
          <div className={styles.acciones}>
            <Boton type="submit" disabled={pendiente}>
              Guardar datos
            </Boton>
          </div>
        </form>
      </section>
    </ModalInventario>
  );
}
