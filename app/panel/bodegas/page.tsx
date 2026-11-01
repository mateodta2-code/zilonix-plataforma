import { requierePermiso, SinPermisoError } from "@/lib/permisos";
import { obtenerContextoPanel } from "@/lib/panel-contexto";
import { listarBodegas, TIPOS_BODEGA } from "@/lib/inventario/bodegas";
import { tienePermiso } from "@/lib/roles";
import { actualizarBodegaAction, crearBodegaAction } from "./actions";
import { Boton } from "@/components/marco/Boton";
import { Campo } from "@/components/marco/Campo";
import { Chip } from "@/components/marco/Chip";
import { EncabezadoPagina } from "@/components/marco/EncabezadoPagina";
import { EstadoVacio } from "@/components/marco/EstadoVacio";
import { SinAcceso } from "@/components/marco/SinAcceso";
import { CeldaTabla, FilaTabla, Tabla } from "@/components/marco/Tabla";
import { Tarjeta } from "@/components/marco/Tarjeta";
import { AvisosUrl, SeccionesInventario } from "@/components/inventario/Avisos";
import styles from "../inventario/inventario.module.css";

// Issue #280 — bodegas de la empresa. Ver pide inventario.consultar;
// crear, inventario.crear; editar, inventario.modificar (también en
// cada acción). Una bodega no se borra: se desactiva.
export default async function BodegasPage({ searchParams }: { searchParams: Record<string, string | string[] | undefined> }) {
  const { usuario, activa, permisos, rolNombre } = await obtenerContextoPanel();
  try {
    await requierePermiso(usuario.id, activa.id, "inventario", "consultar");
  } catch (error) {
    if (!(error instanceof SinPermisoError)) throw error;
    return <SinAcceso mensaje={`Tu rol (${rolNombre}) no tiene acceso a esta pantalla.`} />;
  }
  const puedeCrear = tienePermiso(permisos, "inventario", "crear");
  const puedeEditar = tienePermiso(permisos, "inventario", "modificar");
  const lista = await listarBodegas(activa.id);
  const etiquetaTipo = new Map(TIPOS_BODEGA.map((t) => [t.valor, t.etiqueta]));

  return (
    <>
      <EncabezadoPagina
        titulo="Bodegas"
        descripcion="Dónde está tu stock. La principal es la primera que se usa para reservar los pedidos de Mercado Libre."
      />
      <SeccionesInventario actual="/panel/bodegas" />
      <AvisosUrl searchParams={searchParams} />

      {puedeCrear && (
        <Tarjeta>
          <form action={crearBodegaAction} className={styles.filaForm}>
            <Campo etiqueta="Nombre">
              <input name="nombre" required maxLength={80} className="zx-control" />
            </Campo>
            <Campo etiqueta="Tipo">
              <select name="tipo" defaultValue="propia" className="zx-control">
                {TIPOS_BODEGA.map((t) => (
                  <option key={t.valor} value={t.valor}>
                    {t.etiqueta}
                  </option>
                ))}
              </select>
            </Campo>
            <Boton type="submit">Crear bodega</Boton>
          </form>
        </Tarjeta>
      )}

      <div style={{ height: 16 }} />

      {lista.length === 0 ? (
        <EstadoVacio>Todavía no tienes bodegas. Crea la primera para empezar a cargar stock.</EstadoVacio>
      ) : (
        <Tabla encabezados={["Bodega", "Tipo", "Estado", puedeEditar ? "Editar" : ""]}>
          {lista.map((b) => (
            <FilaTabla key={b.id}>
              <CeldaTabla>
                <strong>{b.nombre}</strong> {b.esPrincipal && <Chip estado="exito">Principal</Chip>}
                <div className={styles.detalle}>{b.sumaAlPublicado ? "Suma a lo publicado en ML" : "No suma a lo publicado en ML"}</div>
              </CeldaTabla>
              <CeldaTabla>{etiquetaTipo.get(b.tipo) ?? b.tipo}</CeldaTabla>
              <CeldaTabla>{b.activa ? <Chip estado="exito">Activa</Chip> : <Chip estado="neutro">Desactivada</Chip>}</CeldaTabla>
              <CeldaTabla>
                {puedeEditar && (
                  <form action={actualizarBodegaAction} className={styles.filaForm}>
                    <input type="hidden" name="bodegaId" value={b.id} />
                    <input name="nombre" defaultValue={b.nombre} required maxLength={80} className="zx-control" aria-label="Nombre" />
                    <label className={styles.check}>
                      <input type="checkbox" name="activa" defaultChecked={b.activa} /> Activa
                    </label>
                    <label className={styles.check}>
                      <input type="checkbox" name="esPrincipal" defaultChecked={b.esPrincipal} disabled={b.tipo === "fulfillment_ml"} /> Principal
                    </label>
                    <label className={styles.check}>
                      <input type="checkbox" name="sumaAlPublicado" defaultChecked={b.sumaAlPublicado} /> Suma a ML
                    </label>
                    <Boton type="submit" variante="secundario" chico>
                      Guardar
                    </Boton>
                  </form>
                )}
              </CeldaTabla>
            </FilaTabla>
          ))}
        </Tabla>
      )}
    </>
  );
}
