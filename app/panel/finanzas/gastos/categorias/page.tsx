import { obtenerContextoPanel } from "@/lib/panel-contexto";
import { normalizarParametro } from "@/lib/filtros-listado";
import { requierePermiso, SinPermisoError } from "@/lib/permisos";
import { tienePermiso } from "@/lib/roles";
import { listarCategoriasGasto } from "@/lib/finanzas/gastos-db";
import { Boton, BotonLink } from "@/components/marco/Boton";
import { Campo } from "@/components/marco/Campo";
import { EncabezadoPagina } from "@/components/marco/EncabezadoPagina";
import { EstadoVacio } from "@/components/marco/EstadoVacio";
import { SinAcceso } from "@/components/marco/SinAcceso";
import { CeldaTabla, FilaTabla, Tabla } from "@/components/marco/Tabla";
import { Tarjeta } from "@/components/marco/Tarjeta";
import { actualizarCategoriaAction, crearCategoriaAction } from "../actions";
import styles from "../../finanzas.module.css";

// Issue #422 (fase 4 de Finanzas) — categorías de gastos de la empresa.
// Ver exige finanzas.consultar; crear, renombrar y desactivar,
// finanzas.modificar (también en el servidor). Nunca se borran: una
// categoría desactivada deja de salir al crear un gasto, pero los gastos
// que ya la usan la conservan.
export default async function CategoriasGastoPage({ searchParams }: { searchParams: Record<string, string | string[] | undefined> }) {
  const { usuario, activa: empresa, rolNombre } = await obtenerContextoPanel();
  let puedeModificar = false;
  let categorias;
  try {
    const miMembresia = await requierePermiso(usuario.id, empresa.id, "finanzas", "consultar");
    puedeModificar = tienePermiso(miMembresia.permisos, "finanzas", "modificar");
    categorias = await listarCategoriasGasto(empresa.id, usuario.id, { incluirInactivas: true });
  } catch (error) {
    if (!(error instanceof SinPermisoError)) throw error;
    return <SinAcceso mensaje={`Tu rol (${rolNombre}) no tiene acceso a Finanzas.`} />;
  }
  const error = normalizarParametro(searchParams.error);
  const ok = normalizarParametro(searchParams.ok);

  return (
    <>
      <EncabezadoPagina titulo="Categorías de gastos" descripcion="Renombra, desactiva o crea las categorías de tus gastos externos." />
      {error && <p className={styles.avisoError}>{error}</p>}
      {ok && <p className={styles.avisoExito}>{ok}</p>}

      {puedeModificar && (
        <Tarjeta>
          <h2 className={styles.tituloSeccion}>Nueva categoría</h2>
          <form action={crearCategoriaAction} className={styles.filtros}>
            <Campo etiqueta="Nombre">
              <input name="nombre" required maxLength={60} className="zx-control" />
            </Campo>
            <div className={styles.accionesFiltro}>
              <Boton type="submit">Crear</Boton>
            </div>
          </form>
        </Tarjeta>
      )}

      <Tarjeta>
        <h2 className={styles.tituloSeccion}>Categorías</h2>
        {categorias.length === 0 ? (
          <EstadoVacio>Todavía no hay categorías.</EstadoVacio>
        ) : (
          <Tabla encabezados={puedeModificar ? ["Nombre", "Activa", ""] : ["Nombre", "Estado"]}>
            {categorias.map((c) =>
              puedeModificar ? (
                <FilaTabla key={c.id}>
                  <CeldaTabla>
                    <input form={`categoria-${c.id}`} name="nombre" required maxLength={60} defaultValue={c.nombre} aria-label="Nombre" className="zx-control" />
                  </CeldaTabla>
                  <CeldaTabla>
                    <label className={styles.casilla}>
                      <input form={`categoria-${c.id}`} type="checkbox" name="activa" defaultChecked={c.activa} /> Activa
                    </label>
                  </CeldaTabla>
                  <CeldaTabla>
                    <form id={`categoria-${c.id}`} action={actualizarCategoriaAction}>
                      <input type="hidden" name="categoriaId" value={c.id} />
                      <Boton type="submit" variante="secundario" chico>
                        Guardar
                      </Boton>
                    </form>
                  </CeldaTabla>
                </FilaTabla>
              ) : (
                <FilaTabla key={c.id}>
                  <CeldaTabla>{c.nombre}</CeldaTabla>
                  <CeldaTabla>{c.activa ? "Activa" : "Inactiva"}</CeldaTabla>
                </FilaTabla>
              )
            )}
          </Tabla>
        )}
      </Tarjeta>

      <BotonLink href="/panel/finanzas/gastos" variante="fantasma" className={styles.volver}>
        Volver a Gastos
      </BotonLink>
    </>
  );
}
