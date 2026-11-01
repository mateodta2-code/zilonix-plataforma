import { randomUUID } from "crypto";
import Link from "next/link";
import { requierePermiso, SinPermisoError } from "@/lib/permisos";
import { obtenerContextoPanel } from "@/lib/panel-contexto";
import { tienePermiso } from "@/lib/roles";
import { listarBodegas } from "@/lib/inventario/bodegas";
import { listarSkusConStock } from "@/lib/inventario/stock";
import { ingresoDirectoAction } from "./actions";
import { Boton } from "@/components/marco/Boton";
import { Campo } from "@/components/marco/Campo";
import { EncabezadoPagina } from "@/components/marco/EncabezadoPagina";
import { SinAcceso } from "@/components/marco/SinAcceso";
import { Tarjeta } from "@/components/marco/Tarjeta";
import { AvisosUrl, SeccionesInventario } from "@/components/inventario/Avisos";
import styles from "../inventario.module.css";

const FILAS = 10;

// Issue #280 — ingreso directo: lo que llegó sin orden de compra. Para
// recibir contra una OC, se entra desde la orden. Ver pide
// inventario.consultar; registrar, inventario.crear (también en la acción).
export default async function IngresosPage({ searchParams }: { searchParams: Record<string, string | string[] | undefined> }) {
  const { usuario, activa, permisos, rolNombre } = await obtenerContextoPanel();
  try {
    await requierePermiso(usuario.id, activa.id, "inventario", "consultar");
  } catch (error) {
    if (!(error instanceof SinPermisoError)) throw error;
    return <SinAcceso mensaje={`Tu rol (${rolNombre}) no tiene acceso a esta pantalla.`} />;
  }
  const puedeCrear = tienePermiso(permisos, "inventario", "crear");
  const [lista, skusSimples] = await Promise.all([listarBodegas(activa.id, { soloActivas: true }), listarSkusConStock(activa.id)]);

  return (
    <>
      <EncabezadoPagina titulo="Ingresos" descripcion="Registra mercancía que llegó. Cada línea entra al kardex como entrada." />
      <SeccionesInventario actual="/panel/inventario/ingresos" />
      <AvisosUrl searchParams={searchParams} />

      {!puedeCrear ? (
        <p className={styles.detalle}>Tu rol puede ver el inventario, pero no registrar ingresos.</p>
      ) : lista.length === 0 || skusSimples.length === 0 ? (
        <div className={styles.avisoSinVincular}>
          Necesitas al menos una bodega activa y un SKU (que no sea kit).{" "}
          <Link href={lista.length === 0 ? "/panel/bodegas" : "/panel/sku"} className={styles.enlaceAviso}>
            {lista.length === 0 ? "Crear bodega" : "Crear SKU"}
          </Link>
        </div>
      ) : (
        <Tarjeta>
          <form action={ingresoDirectoAction} className={styles.form}>
            <input type="hidden" name="recepcionId" value={randomUUID()} />
            <div className={styles.filaForm}>
              <Campo etiqueta="Bodega">
                <select name="bodegaId" required className="zx-control" defaultValue={lista.find((b) => b.esPrincipal)?.id ?? lista[0].id}>
                  {lista.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.nombre}
                    </option>
                  ))}
                </select>
              </Campo>
              <Campo etiqueta="Nota (opcional)">
                <input name="nota" maxLength={200} placeholder="Proveedor, factura…" className="zx-control" />
              </Campo>
            </div>
            <div className={styles.lineasOc}>
              {Array.from({ length: FILAS }, (_, i) => (
                <div key={i} className={styles.filaForm}>
                  <select name={`sku_${i}`} className="zx-control" defaultValue="" aria-label={`SKU línea ${i + 1}`}>
                    <option value="">—</option>
                    {skusSimples.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.codigo} — {s.nombre}
                      </option>
                    ))}
                  </select>
                  <input name={`cantidad_${i}`} type="number" min={1} step={1} placeholder="Cantidad" className="zx-control" aria-label={`Cantidad línea ${i + 1}`} />
                </div>
              ))}
            </div>
            <Boton type="submit" className={styles.botonCrear}>
              Registrar ingreso
            </Boton>
          </form>
        </Tarjeta>
      )}
    </>
  );
}
