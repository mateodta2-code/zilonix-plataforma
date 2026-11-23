import { Boton } from "@/components/marco/Boton";
import { Campo } from "@/components/marco/Campo";
import type { TiendaGasto } from "@/lib/finanzas/gastos-db";
import styles from "../finanzas.module.css";

// Issue #422 (fase 4 de Finanzas) — mismo formulario para crear (rápido,
// arriba de la lista) y editar un gasto. La moneda no se elige: sale de
// la tienda o de la empresa (lib/finanzas/gastos-db.ts).

export type ValoresGasto = {
  id: string;
  tienda: string;
  categoriaId: string;
  terceroId: string | null;
  beneficiario: string | null;
  descripcion: string;
  monto: string;
  fechaGasto: string;
  fechaVencimiento: string | null;
  estado: "pendiente" | "pagado";
  fechaPago: string | null;
  medioPago: string | null;
  soporte: string | null;
};

const ETIQUETA_MARKETPLACE = { ml: "Mercado Libre", falabella: "Falabella" } as const;

export function FormularioGasto({
  accion,
  hoy,
  tiendas,
  categorias,
  proveedores,
  valores,
  volver,
  textoBoton,
}: {
  accion: (formData: FormData) => Promise<void>;
  hoy: string;
  tiendas: TiendaGasto[];
  categorias: { id: string; nombre: string; activa: boolean }[];
  proveedores: { id: string; nombre: string }[];
  valores?: ValoresGasto;
  volver?: string;
  textoBoton: string;
}) {
  // Al editar, la categoría inactiva que ya tenía el gasto sigue en la lista.
  const opcionesCategoria = categorias.filter((c) => c.activa || c.id === valores?.categoriaId);
  return (
    <form action={accion} className={styles.form}>
      {valores && <input type="hidden" name="gastoId" value={valores.id} />}
      {volver && <input type="hidden" name="volver" value={volver} />}
      <div className={styles.grilla}>
        <Campo etiqueta="Descripción">
          <input name="descripcion" required maxLength={300} defaultValue={valores?.descripcion ?? ""} placeholder="Ej. Arriendo bodega noviembre" className="zx-control" />
        </Campo>
        <Campo etiqueta="Monto">
          <input name="monto" required inputMode="decimal" defaultValue={valores?.monto ?? ""} placeholder="Ej. 1500000" className="zx-control" />
        </Campo>
        <Campo etiqueta="Categoría">
          <select name="categoriaId" required defaultValue={valores?.categoriaId ?? ""} className="zx-control">
            <option value="" disabled>
              Elige una
            </option>
            {opcionesCategoria.map((c) => (
              <option key={c.id} value={c.id}>
                {c.nombre}
                {c.activa ? "" : " (inactiva)"}
              </option>
            ))}
          </select>
        </Campo>
        <Campo etiqueta="Tienda (opcional)">
          <select name="tienda" defaultValue={valores?.tienda ?? ""} className="zx-control">
            <option value="">Toda la empresa</option>
            {tiendas.map((t) => (
              <option key={t.clave} value={t.clave}>
                {t.nombre} ({ETIQUETA_MARKETPLACE[t.marketplace]})
              </option>
            ))}
          </select>
        </Campo>
        <Campo etiqueta="Proveedor">
          <select name="terceroId" defaultValue={valores?.terceroId ?? ""} className="zx-control">
            <option value="">Otro (escríbelo al lado)</option>
            {proveedores.map((p) => (
              <option key={p.id} value={p.id}>
                {p.nombre}
              </option>
            ))}
          </select>
        </Campo>
        <Campo etiqueta="Beneficiario (si no es un proveedor)">
          <input name="beneficiario" maxLength={120} defaultValue={valores?.beneficiario ?? ""} placeholder="Ej. Contadora, arrendador" className="zx-control" />
        </Campo>
        <Campo etiqueta="Fecha del gasto">
          <input type="date" name="fechaGasto" required defaultValue={valores?.fechaGasto ?? hoy} className="zx-control" />
        </Campo>
        <Campo etiqueta="Vence (opcional)">
          <input type="date" name="fechaVencimiento" defaultValue={valores?.fechaVencimiento ?? ""} className="zx-control" />
        </Campo>
        <Campo etiqueta="Medio de pago (opcional)">
          <input name="medioPago" maxLength={60} defaultValue={valores?.medioPago ?? ""} placeholder="Ej. Transferencia" className="zx-control" />
        </Campo>
        <Campo etiqueta="Soporte (opcional)">
          <input name="soporte" maxLength={300} defaultValue={valores?.soporte ?? ""} placeholder="Nº de factura o enlace" className="zx-control" />
        </Campo>
        <Campo etiqueta="Fecha de pago (si ya se pagó)">
          <input type="date" name="fechaPago" defaultValue={valores?.fechaPago ?? ""} className="zx-control" />
        </Campo>
      </div>
      <label className={styles.casilla}>
        <input type="checkbox" name="pagado" defaultChecked={valores?.estado === "pagado"} /> Ya está pagado
      </label>
      <div className={styles.acciones}>
        <Boton type="submit">{textoBoton}</Boton>
      </div>
    </form>
  );
}
