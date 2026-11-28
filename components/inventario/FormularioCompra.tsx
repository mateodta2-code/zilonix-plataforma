"use client";

import { useState } from "react";
import { Boton } from "@/components/marco/Boton";
import { Campo } from "@/components/marco/Campo";
import { PLATAFORMAS_COMPRA, sugerirCodigoSku } from "@/lib/inventario/registro-compras";
import styles from "@/app/panel/inventario/inventario.module.css";

// Registro de compras (27-nov) — «Agregar compra»: una fila = un producto,
// como la hoja del Zilonix OS. El producto se elige de los SKU que ya
// existen o se crea acá mismo: el SKU se sugiere al escribir el nombre
// (FUL + 3 letras + 4 números) y se puede editar antes de guardar. La
// validación de verdad la hace el servidor (registrarCompra).

type Props = {
  accion: (formData: FormData) => void | Promise<void>;
  skus: { id: string; codigo: string; nombre: string }[];
  bodegas: { id: string; nombre: string; esPrincipal: boolean }[];
  proveedores: { id: string; nombre: string }[];
  formasPago: string[];
  hoy: string;
};

export function FormularioCompra({ accion, skus, bodegas, proveedores, formasPago, hoy }: Props) {
  const [modo, setModo] = useState<"existente" | "nuevo">(skus.length > 0 ? "existente" : "nuevo");
  const [nombre, setNombre] = useState("");
  const [sku, setSku] = useState("");
  // Mientras la persona no toque el SKU, sigue al nombre; si lo edita,
  // se respeta lo que escribió.
  const [skuEditado, setSkuEditado] = useState(false);

  function cambiarNombre(valor: string) {
    setNombre(valor);
    if (!skuEditado) setSku(valor.trim() === "" ? "" : sugerirCodigoSku(valor));
  }

  return (
    <form action={accion} className={styles.form}>
      <input type="hidden" name="productoModo" value={modo} />

      <div className={styles.filaForm}>
        <Campo etiqueta="Fecha de compra">
          <input type="date" name="fechaCompra" defaultValue={hoy} required className="zx-control" />
        </Campo>
        <Campo etiqueta="Producto">
          <select value={modo} onChange={(e) => setModo(e.target.value as "existente" | "nuevo")} className="zx-control" aria-label="¿Producto existente o nuevo?">
            {skus.length > 0 && <option value="existente">Ya existe (elegir SKU)</option>}
            <option value="nuevo">Producto nuevo (crear SKU)</option>
          </select>
        </Campo>
        {modo === "existente" ? (
          <Campo etiqueta="SKU">
            <select name="skuId" required className="zx-control" defaultValue="">
              <option value="" disabled>
                Elige el SKU…
              </option>
              {skus.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.codigo} — {s.nombre}
                </option>
              ))}
            </select>
          </Campo>
        ) : (
          <>
            <Campo etiqueta="Nombre del producto">
              <input name="nombreNuevo" value={nombre} onChange={(e) => cambiarNombre(e.target.value)} required minLength={2} maxLength={200} className="zx-control" />
            </Campo>
            <Campo etiqueta="SKU (sugerido, editable)">
              <input
                name="skuNuevo"
                value={sku}
                onChange={(e) => {
                  setSkuEditado(true);
                  setSku(e.target.value.toUpperCase());
                }}
                required
                pattern="[A-Za-z0-9][A-Za-z0-9_\-]{2,39}"
                title="De 3 a 40 letras, números o guiones, sin espacios."
                className="zx-control"
              />
            </Campo>
            <Boton
              type="button"
              variante="fantasma"
              onClick={() => {
                setSkuEditado(false);
                setSku(nombre.trim() === "" ? "" : sugerirCodigoSku(nombre));
              }}
            >
              Otro SKU
            </Boton>
          </>
        )}
      </div>

      <div className={styles.filaForm}>
        <Campo etiqueta="Cantidad">
          <input name="cantidad" type="number" min={1} step={1} required className="zx-control" />
        </Campo>
        <Campo etiqueta="Valor unidad">
          <input name="valorUnidad" inputMode="decimal" placeholder="Ej. 36252" className="zx-control" />
        </Campo>
        <Campo etiqueta="Forma de pago">
          <input name="formaPago" list="formas-pago-compra" maxLength={60} placeholder="Elige o escribe" className="zx-control" />
          <datalist id="formas-pago-compra">
            {formasPago.map((f) => (
              <option key={f} value={f} />
            ))}
          </datalist>
        </Campo>
        <Campo etiqueta="Plataforma">
          <input name="plataforma" list="plataformas-compra" maxLength={40} placeholder="Elige o escribe otra" className="zx-control" />
          <datalist id="plataformas-compra">
            {PLATAFORMAS_COMPRA.map((p) => (
              <option key={p} value={p} />
            ))}
          </datalist>
        </Campo>
      </div>

      <div className={styles.filaForm}>
        <Campo etiqueta="Orden de compra (de la plataforma)">
          <input name="ordenPlataforma" maxLength={80} placeholder="Ej. 114-1234567-1234567" className="zx-control" />
        </Campo>
        <Campo etiqueta="Link de compra">
          <input name="linkCompra" type="url" maxLength={500} placeholder="https://…" className="zx-control" />
        </Campo>
        <Campo etiqueta="Entrega estimada">
          <input name="entregaEstimada" type="date" className="zx-control" />
        </Campo>
      </div>

      <div className={styles.filaForm}>
        <Campo etiqueta="Bodega de destino">
          <select name="bodegaDestinoId" required className="zx-control" defaultValue={bodegas.find((b) => b.esPrincipal)?.id ?? bodegas[0]?.id}>
            {bodegas.map((b) => (
              <option key={b.id} value={b.id}>
                {b.nombre}
              </option>
            ))}
          </select>
        </Campo>
        {proveedores.length > 0 && (
          <Campo etiqueta="Proveedor (opcional)">
            <select name="terceroId" className="zx-control" defaultValue="">
              <option value="">Sin proveedor</option>
              {proveedores.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.nombre}
                </option>
              ))}
            </select>
          </Campo>
        )}
        <Campo etiqueta="Nota (opcional)">
          <input name="nota" maxLength={200} className="zx-control" />
        </Campo>
      </div>

      <Boton type="submit" className={styles.botonCrear}>
        Agregar compra
      </Boton>
    </form>
  );
}
