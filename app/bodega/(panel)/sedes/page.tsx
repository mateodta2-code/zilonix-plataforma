import { normalizarParametro } from "@/lib/filtros-listado";
import { Boton } from "@/components/marco/Boton";
import { Campo } from "@/components/marco/Campo";
import { Chip } from "@/components/marco/Chip";
import { EncabezadoPagina } from "@/components/marco/EncabezadoPagina";
import { EstadoVacio } from "@/components/marco/EstadoVacio";
import { CeldaTabla, FilaTabla, Tabla } from "@/components/marco/Tabla";
import { Tarjeta } from "@/components/marco/Tarjeta";
import { SinAccesoBodega } from "@/components/bodega/SinAccesoBodega";
import { accesoBodega } from "@/lib/bodega/contexto";
import { listarSedes } from "@/lib/bodega/sedes";
import styles from "@/app/panel/personas/page.module.css";
import formStyles from "@/app/panel/invitar/page.module.css";
import { cambiarActivaSedeAction, crearSedeAction, editarSedeAction } from "./actions";

// Sedes de la bodega: todos los miembros las ven; solo admin_bodega agrega,
// edita y desactiva/reactiva (nunca se borran).
export default async function BodegaSedesPage({ searchParams }: { searchParams: Record<string, string | string[] | undefined> }) {
  const { decision } = await accesoBodega("bodega");
  if (!decision.ok) return <SinAccesoBodega motivo={decision.motivo} volverHref="/bodega" volverTexto="Volver a la bodega" />;
  const { bodegaId, rol } = decision.membresia;
  const esAdmin = rol === "admin_bodega";
  const sedes = await listarSedes(bodegaId, rol);
  const error = normalizarParametro(searchParams.error);
  const ok = normalizarParametro(searchParams.ok);

  const formularioNueva = (
    <form action={crearSedeAction} className={formStyles.form}>
      <Campo etiqueta="Nombre de la sede">
        <input name="nombre" required minLength={2} maxLength={80} className="zx-control" />
      </Campo>
      <Campo etiqueta="Dirección (opcional)">
        <input name="direccion" maxLength={200} className="zx-control" />
      </Campo>
      <Campo etiqueta="Ciudad (opcional)">
        <input name="ciudad" maxLength={80} className="zx-control" />
      </Campo>
      <Boton type="submit" className={formStyles.botonEnviar}>
        Agregar sede
      </Boton>
    </form>
  );

  return (
    <>
      <EncabezadoPagina titulo="Sedes" descripcion="Los puntos físicos de la bodega." />
      {error && <p className={styles.avisoError}>{error}</p>}
      {ok && <p className={styles.avisoExito}>{ok}</p>}

      <Tarjeta className={styles.seccion}>
        <h2 className={styles.titulo}>Sedes ({sedes.length})</h2>
        {sedes.length === 0 ? (
          <EstadoVacio>{esAdmin ? "Agrega tu primera sede." : "Esta bodega todavía no tiene sedes."}</EstadoVacio>
        ) : (
          <Tabla encabezados={esAdmin ? ["Sede", "Estado", "Acciones"] : ["Sede", "Dirección", "Ciudad", "Estado"]}>
            {sedes.map((s) =>
              esAdmin ? (
                <FilaTabla key={s.id}>
                  <CeldaTabla>
                    <form action={editarSedeAction} className={styles.formRol}>
                      <input type="hidden" name="sedeId" value={s.id} />
                      <input name="nombre" required minLength={2} maxLength={80} defaultValue={s.nombre} className="zx-control" aria-label="Nombre de la sede" />
                      <input name="direccion" maxLength={200} defaultValue={s.direccion ?? ""} placeholder="Dirección" className="zx-control" aria-label="Dirección" />
                      <input name="ciudad" maxLength={80} defaultValue={s.ciudad ?? ""} placeholder="Ciudad" className="zx-control" aria-label="Ciudad" />
                      <Boton type="submit" variante="primario">
                        Guardar
                      </Boton>
                    </form>
                  </CeldaTabla>
                  <CeldaTabla>
                    <Chip estado={s.activa ? "exito" : "neutro"}>{s.activa ? "activa" : "desactivada"}</Chip>
                  </CeldaTabla>
                  <CeldaTabla>
                    <form action={cambiarActivaSedeAction}>
                      <input type="hidden" name="sedeId" value={s.id} />
                      <input type="hidden" name="activa" value={s.activa ? "0" : "1"} />
                      <Boton type="submit" variante="fantasma">
                        {s.activa ? "Desactivar" : "Reactivar"}
                      </Boton>
                    </form>
                  </CeldaTabla>
                </FilaTabla>
              ) : (
                <FilaTabla key={s.id}>
                  <CeldaTabla>
                    <strong>{s.nombre}</strong>
                  </CeldaTabla>
                  <CeldaTabla>{s.direccion ?? "—"}</CeldaTabla>
                  <CeldaTabla>{s.ciudad ?? "—"}</CeldaTabla>
                  <CeldaTabla>
                    <Chip estado={s.activa ? "exito" : "neutro"}>{s.activa ? "activa" : "desactivada"}</Chip>
                  </CeldaTabla>
                </FilaTabla>
              )
            )}
          </Tabla>
        )}
      </Tarjeta>

      {esAdmin && (
        <Tarjeta className={styles.seccion}>
          <h2 className={styles.titulo}>Agregar una sede</h2>
          {formularioNueva}
        </Tarjeta>
      )}
    </>
  );
}
