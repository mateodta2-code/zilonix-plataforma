import { obtenerContextoPanel } from "@/lib/panel-contexto";
import { leerConfiguracionFinanzas } from "@/lib/configuracion-finanzas";
import { normalizarParametro } from "@/lib/filtros-listado";
import { mostrarMonto } from "@/lib/finanzas/montos";
import { requierePermiso, SinPermisoError } from "@/lib/permisos";
import { fechaHoraBogota } from "@/components/finanzas/formato";
import { Boton, BotonLink } from "@/components/marco/Boton";
import { Campo } from "@/components/marco/Campo";
import { EncabezadoPagina } from "@/components/marco/EncabezadoPagina";
import { SinAcceso } from "@/components/marco/SinAcceso";
import { Tarjeta } from "@/components/marco/Tarjeta";
import { guardarValorFlexAction } from "./actions";
import styles from "../finanzas.module.css";

// Issue #126 (slice urgente, Sharel 30-oct) — configuración de Finanzas
// de la empresa activa. Por ahora solo la forma de entrega: el valor
// fijo de envío Flex (configuracion_finanzas.flex_valor), que cada
// empresa pone el suyo. Sin ese valor las ventas Flex no se congelan
// (ni siquiera el costo del producto) y salen «sin costo». Titulares,
// IVA de publicidad, avisos y metas llegan con el resto de #126.
//
// Ver pide finanzas.consultar; guardar, finanzas.modificar (el
// formulario solo sale con ese permiso, y la acción y
// lib/configuracion-finanzas.ts lo vuelven a pedir).
export default async function ConfiguracionFinanzasPage({ searchParams }: { searchParams: Record<string, string | string[] | undefined> }) {
  const { usuario, activa: empresa, rolNombre } = await obtenerContextoPanel();
  try {
    await requierePermiso(usuario.id, empresa.id, "finanzas", "consultar");
  } catch (error) {
    if (!(error instanceof SinPermisoError)) throw error;
    return <SinAcceso mensaje={`Tu rol (${rolNombre}) no tiene acceso a Finanzas.`} />;
  }

  let puedeModificar = true;
  try {
    await requierePermiso(usuario.id, empresa.id, "finanzas", "modificar");
  } catch (error) {
    if (!(error instanceof SinPermisoError)) throw error;
    puedeModificar = false;
  }

  const config = await leerConfiguracionFinanzas(empresa.id);
  const flexValor = config?.flexValor ?? null;
  const error = normalizarParametro(searchParams.error);
  const ok = normalizarParametro(searchParams.ok);

  return (
    <>
      <EncabezadoPagina titulo="Configuración de Finanzas" descripcion={`Valores de ${empresa.nombre} que usa el cálculo de utilidad.`} />
      {error && <p className={styles.avisoError}>{error}</p>}
      {ok && <p className={styles.avisoExito}>{ok}</p>}

      <Tarjeta>
        <h2 className={styles.tituloSeccion}>Forma de entrega</h2>
        <ul className={styles.ayuda}>
          <li>
            <strong>Full de Mercado Libre:</strong> envío $0 (no se edita; la forma de cada venta sale de la logística de Mercado Libre).
          </li>
          <li>
            <strong>Agencia:</strong> el envío sale de cada SKU en la Tabla maestra de SKU.
          </li>
          <li>
            <strong>Flex:</strong> un valor fijo por paquete, el de abajo.
          </li>
        </ul>

        <p>
          Valor Flex actual: <strong>{flexValor === null ? "sin configurar" : mostrarMonto(flexValor)}</strong>
          {config && flexValor !== null && <span className={styles.ayuda}> · actualizado el {fechaHoraBogota(config.actualizadaTs)}</span>}
        </p>
        {flexValor === null && (
          <p className={styles.avisoError}>
            Sin valor Flex, las ventas Flex no se congelan: salen «sin costo» y quedan fuera de la utilidad aunque el SKU tenga costo.
          </p>
        )}

        {puedeModificar ? (
          <form action={guardarValorFlexAction} className={styles.form}>
            <div className={styles.grilla}>
              <Campo etiqueta="Valor Flex por paquete (COP)">
                {/* Con el mismo formato que se muestra («10.000»), que la
                    acción vuelve a leer igual. */}
                <input
                  name="flexValor"
                  required
                  inputMode="decimal"
                  placeholder="10.000"
                  defaultValue={flexValor === null ? "" : mostrarMonto(flexValor).replace(/^\$\s*/, "")}
                  className="zx-control"
                />
              </Campo>
            </div>
            <p className={styles.ayuda}>
              El nuevo valor Flex solo aplica a ventas que se sincronicen desde hoy. Las ventas ya congeladas no cambian. Las Flex que hoy salen
              «sin costo» se congelan con este valor al usar «Traer ventas de este mes» en Finanzas → Ventas.
            </p>
            <div className={styles.acciones}>
              <Boton type="submit">Guardar valor Flex</Boton>
            </div>
          </form>
        ) : (
          <p className={styles.ayuda}>Tu rol solo puede consultar este valor.</p>
        )}
      </Tarjeta>

      <BotonLink href="/panel/finanzas" variante="fantasma" chico className={styles.volver}>
        Volver a Finanzas
      </BotonLink>
    </>
  );
}
