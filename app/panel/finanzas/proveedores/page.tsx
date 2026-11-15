import { obtenerContextoPanel } from "@/lib/panel-contexto";
import { normalizarParametro } from "@/lib/filtros-listado";
import { mostrarMonto } from "@/lib/finanzas/montos";
import { requierePermiso, SinPermisoError } from "@/lib/permisos";
import { tienePermiso } from "@/lib/roles";
import { listarTerceros } from "@/lib/terceros";
import { cambiarActivoProveedorAction, crearProveedorAction } from "./actions";
import { ETIQUETAS_CONDICION, ETIQUETAS_TIPO, FormularioProveedor } from "./FormularioProveedor";
import { Boton, BotonLink } from "@/components/marco/Boton";
import { Chip } from "@/components/marco/Chip";
import { CeldaTabla, FilaTabla, Tabla } from "@/components/marco/Tabla";
import { EncabezadoPagina } from "@/components/marco/EncabezadoPagina";
import { EstadoVacio } from "@/components/marco/EstadoVacio";
import { SinAcceso } from "@/components/marco/SinAcceso";
import { Tarjeta } from "@/components/marco/Tarjeta";
import styles from "../finanzas.module.css";

// Issue #128 (Z-FIN-06) — proveedores y transportadores de la empresa:
// packing, condición de pago y tercero habitual. Ver exige
// finanzas.consultar; crear, editar y desactivar, finanzas.modificar
// (también en el servidor, en actions.ts).
export default async function ProveedoresPage({ searchParams }: { searchParams: Record<string, string | string[] | undefined> }) {
  const { usuario, activa: empresa, rolNombre } = await obtenerContextoPanel();

  let puedeModificar = false;
  try {
    const miMembresia = await requierePermiso(usuario.id, empresa.id, "finanzas", "consultar");
    puedeModificar = tienePermiso(miMembresia.permisos, "finanzas", "modificar");
  } catch (error) {
    if (!(error instanceof SinPermisoError)) throw error;
    return <SinAcceso mensaje={`Tu rol (${rolNombre}) no tiene acceso a Finanzas.`} />;
  }

  const lista = await listarTerceros(empresa.id, { incluirInactivos: true });
  const error = normalizarParametro(searchParams.error);
  const ok = normalizarParametro(searchParams.ok);

  return (
    <>
      <EncabezadoPagina
        titulo="Proveedores y transportadores"
        descripcion="El packing se pone una vez aquí y cada SKU lo toma de su proveedor."
        accion={
          <BotonLink href="/panel/finanzas/maestra-sku" variante="secundario" chico>
            Tabla maestra de SKU
          </BotonLink>
        }
      />

      {error && <p className={styles.avisoError}>{error}</p>}
      {ok && <p className={styles.avisoExito}>{ok}</p>}

      {lista.length === 0 ? (
        <EstadoVacio>Todavía no hay proveedores ni transportadores.</EstadoVacio>
      ) : (
        <Tabla encabezados={["Nombre", "Tipo", "Packing", "Pago", "Plazo", "Habitual", "Estado", ""]}>
          {lista.map((t) => {
            const habitual = [t.predeterminadoEnvioAgencia && "Agencia", t.predeterminadoEmpaque && "Empaque", t.predeterminadoFlex && "Flex"].filter(Boolean);
            return (
              <FilaTabla key={t.id}>
                <CeldaTabla>
                  <strong>{t.nombre}</strong>
                </CeldaTabla>
                <CeldaTabla>{ETIQUETAS_TIPO[t.tipo]}</CeldaTabla>
                <CeldaTabla>{t.empaque === null ? <span className={styles.suave}>Sin dato</span> : mostrarMonto(t.empaque)}</CeldaTabla>
                <CeldaTabla>
                  {ETIQUETAS_CONDICION[t.condicionPago]}
                  {t.periodicidad && <span className={styles.suave}> · {t.periodicidad}</span>}
                </CeldaTabla>
                <CeldaTabla>{t.plazoDias === null ? <span className={styles.suave}>Configuración</span> : `${t.plazoDias} días`}</CeldaTabla>
                <CeldaTabla>{habitual.length > 0 ? habitual.join(", ") : "—"}</CeldaTabla>
                <CeldaTabla>{t.activo ? <Chip estado="exito">Activo</Chip> : <Chip>Inactivo</Chip>}</CeldaTabla>
                <CeldaTabla>
                  {puedeModificar && (
                    <div className={styles.accionesFiltro}>
                      <BotonLink href={`/panel/finanzas/proveedores/${t.id}`} variante="fantasma" chico>
                        Editar
                      </BotonLink>
                      <form action={cambiarActivoProveedorAction}>
                        <input type="hidden" name="terceroId" value={t.id} />
                        <input type="hidden" name="activo" value={t.activo ? "0" : "1"} />
                        <Boton type="submit" variante="fantasma" chico>
                          {t.activo ? "Desactivar" : "Activar"}
                        </Boton>
                      </form>
                    </div>
                  )}
                </CeldaTabla>
              </FilaTabla>
            );
          })}
        </Tabla>
      )}

      {puedeModificar && (
        <section className={styles.seccion}>
          <h2 className={styles.tituloSeccion}>Nuevo tercero</h2>
          <Tarjeta>
            <FormularioProveedor accion={crearProveedorAction} textoBoton="Crear tercero" />
          </Tarjeta>
        </section>
      )}

      <BotonLink href="/panel/finanzas" variante="fantasma" chico className={styles.volver}>
        Volver a Finanzas
      </BotonLink>
    </>
  );
}
