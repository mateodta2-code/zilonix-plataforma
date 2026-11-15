import { Boton } from "@/components/marco/Boton";
import { Campo } from "@/components/marco/Campo";
import styles from "../finanzas.module.css";

// Issue #128 — mismo formulario para crear y editar un tercero.
export type ValoresProveedor = {
  id?: string;
  nombre: string;
  tipo: string;
  empaque: string | null;
  condicionPago: string | null;
  periodicidad: string | null;
  plazoDias: number | null;
  predeterminadoEnvioAgencia: boolean;
  predeterminadoEmpaque: boolean;
  predeterminadoFlex: boolean;
};

export const ETIQUETAS_TIPO: Record<string, string> = {
  proveedor_producto: "Proveedor de producto",
  empaque: "Empaque",
  agencia: "Agencia",
  flex: "Flex",
  otro: "Otro",
};

export const ETIQUETAS_CONDICION: Record<string, string> = {
  inmediato: "Inmediato",
  cuenta_cobro: "Cuenta de cobro",
  anticipado_full_ml: "Anticipado (Full de Mercado Libre)",
};

export function FormularioProveedor({
  accion,
  valores,
  textoBoton,
}: {
  accion: (formData: FormData) => Promise<void>;
  valores?: ValoresProveedor;
  textoBoton: string;
}) {
  const esEdicion = Boolean(valores?.id);
  return (
    <form action={accion} className={styles.form}>
      {valores?.id && <input type="hidden" name="terceroId" value={valores.id} />}
      <div className={styles.grilla}>
        <Campo etiqueta="Nombre">
          <input name="nombre" required maxLength={120} defaultValue={valores?.nombre ?? ""} className="zx-control" />
        </Campo>
        <Campo etiqueta="Tipo">
          <select name="tipo" required defaultValue={valores?.tipo ?? "proveedor_producto"} className="zx-control">
            {Object.entries(ETIQUETAS_TIPO).map(([valor, etiqueta]) => (
              <option key={valor} value={valor}>
                {etiqueta}
              </option>
            ))}
          </select>
        </Campo>
        <Campo etiqueta="Packing por paquete (vacío = sin dato; 0 = no cobra)">
          <input name="empaque" inputMode="decimal" placeholder="Ej. 3.000" defaultValue={valores?.empaque ?? ""} className="zx-control" />
        </Campo>
        <Campo etiqueta="Condición de pago">
          <select name="condicionPago" defaultValue={valores?.condicionPago ?? ""} className="zx-control">
            {!esEdicion && <option value="">Según el tipo (agencia y Flex: cuenta de cobro semanal)</option>}
            {Object.entries(ETIQUETAS_CONDICION).map(([valor, etiqueta]) => (
              <option key={valor} value={valor}>
                {etiqueta}
              </option>
            ))}
          </select>
        </Campo>
        <Campo etiqueta="Periodicidad (solo cuenta de cobro)">
          <select name="periodicidad" defaultValue={valores?.periodicidad ?? ""} className="zx-control">
            <option value="">{esEdicion ? "Sin periodicidad" : "Según el tipo"}</option>
            <option value="semanal">Semanal (cierra el domingo)</option>
            <option value="quincenal">Quincenal (cierra el 15 y el último día)</option>
            <option value="mensual">Mensual (cierra el último día)</option>
          </select>
        </Campo>
        <Campo etiqueta="Plazo para pagar, en días (vacío = el de la configuración)">
          <input name="plazoDias" inputMode="numeric" defaultValue={valores?.plazoDias ?? ""} className="zx-control" />
        </Campo>
      </div>

      <fieldset className={styles.form}>
        <legend className={styles.suave}>Tercero habitual (uno por concepto en la empresa)</legend>
        <label className={styles.casilla}>
          <input type="checkbox" name="predeterminadoEnvioAgencia" defaultChecked={valores?.predeterminadoEnvioAgencia} /> Envío a agencia
        </label>
        <label className={styles.casilla}>
          <input type="checkbox" name="predeterminadoEmpaque" defaultChecked={valores?.predeterminadoEmpaque} /> Empaque
        </label>
        <label className={styles.casilla}>
          <input type="checkbox" name="predeterminadoFlex" defaultChecked={valores?.predeterminadoFlex} /> Flex (mensajero habitual)
        </label>
        <p className={styles.ayuda}>
          Agencia y empaque suelen ser el mismo tercero: marca las dos casillas en él. Se pueden separar cuando haga falta.
        </p>
      </fieldset>

      <p className={styles.ayuda}>
        Cambiar la condición de pago o el plazo aplica solo a las cuentas por pagar nuevas: las que ya se generaron no cambian. Cambiar
        el packing cambia el packing de los SKU que usan el del proveedor, solo para ventas nuevas.
      </p>
      <div className={styles.acciones}>
        <Boton type="submit">{textoBoton}</Boton>
      </div>
    </form>
  );
}
