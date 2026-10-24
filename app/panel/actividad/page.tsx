import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { listarAuditoriaDeEmpresa, opcionesFiltroAuditoria } from "@/lib/auditoria";
import { listarEmpresasDeUsuario } from "@/lib/empresas";
import { obtenerOCrearUsuarioActual } from "@/lib/usuarios";
import { requierePermiso, SinPermisoError } from "@/lib/permisos";
import { normalizarParametro } from "@/lib/filtros-listado";
import { Boton, BotonLink } from "@/components/marco/Boton";
import { Campo } from "@/components/marco/Campo";
import { CeldaTabla, FilaTabla, Tabla } from "@/components/marco/Tabla";
import { EncabezadoPagina } from "@/components/marco/EncabezadoPagina";
import { EstadoVacio } from "@/components/marco/EstadoVacio";
import { SinAcceso } from "@/components/marco/SinAcceso";
import styles from "./page.module.css";

// Tarea 1.9 — "Ves en Actividad las 5 acciones con tu nombre y hora;
// una venta sincronizada automáticamente aparece con actor
// 'Integración ML', no con el nombre de una persona". Hoy no hay
// ninguna integración real todavía (eso es Fase 2), así que la parte
// de "sistema" de este criterio queda probada en
// db/auditoria.test.ts contra Postgres real, no en esta pantalla con
// un dato inventado — una fila falsa de "Integración ML" acá se vería
// como un dato real de la empresa y no lo es.
//
// Issue #124 (Z-FIN-02) — bitácora: filtros por entidad y por quién.
// Los valores de la URL solo se aceptan si están en las opciones que
// salen de la propia bitácora de esta empresa (lista blanca); uno que
// no está — o un usuario de otra empresa — se ignora como si no
// hubiera filtro, nunca llega a la consulta. "Qué cambió" es hoy la
// columna `detalle`: auditoria todavía no guarda valor anterior/nuevo
// por separado (eso llega con el issue #125, con su migración).
export default async function ActividadPage({ searchParams }: { searchParams: Record<string, string | string[] | undefined> }) {
  const usuario = await obtenerOCrearUsuarioActual();
  if (!usuario) redirect("/sign-in");

  const propias = await listarEmpresasDeUsuario(usuario.id);
  const empresaId = cookies().get("empresa_actual")?.value;
  const empresa = propias.find((e) => e.id === empresaId) ?? propias[0];
  if (!empresa) redirect("/crear-empresa");

  try {
    await requierePermiso(usuario.id, empresa.id, "configuracion", "consultar");
  } catch (error) {
    if (!(error instanceof SinPermisoError)) throw error;
    return <SinAcceso mensaje={`Tu rol no puede ver la actividad de ${empresa.nombre}.`} />;
  }

  const opciones = await opcionesFiltroAuditoria(empresa.id);
  const entidadPedida = normalizarParametro(searchParams.entidad);
  const usuarioPedido = normalizarParametro(searchParams.usuario);
  const entidad = entidadPedida && opciones.entidades.includes(entidadPedida) ? entidadPedida : undefined;
  const usuarioId = usuarioPedido && opciones.actores.some((a) => a.valor === usuarioPedido) ? usuarioPedido : undefined;
  const hayFiltrosActivos = Boolean(entidad || usuarioId);

  const filas = await listarAuditoriaDeEmpresa(empresa.id, 50, { entidad, usuarioId });

  return (
    <>
      <EncabezadoPagina
        titulo={`Actividad de ${empresa.nombre}`}
        descripcion="Quién hizo qué, cuándo — nunca se le atribuye a una persona lo que hizo una integración."
      />

      <form method="get" className={styles.filtros}>
        <Campo etiqueta="Entidad">
          <select name="entidad" defaultValue={entidad ?? ""} className="zx-control">
            <option value="">Todas</option>
            {opciones.entidades.map((e) => (
              <option key={e} value={e}>
                {e}
              </option>
            ))}
          </select>
        </Campo>
        <Campo etiqueta="Quién">
          <select name="usuario" defaultValue={usuarioId ?? ""} className="zx-control">
            <option value="">Todos</option>
            {opciones.actores.map((a) => (
              <option key={a.valor} value={a.valor}>
                {a.nombre}
              </option>
            ))}
          </select>
        </Campo>
        <div className={styles.accionesFiltro}>
          <Boton type="submit" chico>
            Filtrar
          </Boton>
          {hayFiltrosActivos && (
            <BotonLink href="/panel/actividad" variante="fantasma" chico>
              Limpiar filtros
            </BotonLink>
          )}
        </div>
      </form>

      {filas.length === 0 ? (
        <EstadoVacio>{hayFiltrosActivos ? "Ningún evento coincide con esos filtros." : "Todavía no hay actividad registrada."}</EstadoVacio>
      ) : (
        <Tabla encabezados={["Cuándo", "Quién", "Acción · entidad", "Qué cambió"]}>
          {filas.map((f) => (
            <FilaTabla key={f.id}>
              <CeldaTabla className={styles.celdaFecha}>{new Date(f.ts).toLocaleString("es-CO")}</CeldaTabla>
              <CeldaTabla className={f.actorTipo === "sistema" ? styles.actorSistema : undefined}>{f.actorNombre}</CeldaTabla>
              <CeldaTabla>
                {f.accion} · {f.entidad}
              </CeldaTabla>
              <CeldaTabla>{f.detalle ?? "—"}</CeldaTabla>
            </FilaTabla>
          ))}
        </Tabla>
      )}

      <BotonLink href="/panel" variante="fantasma" chico className={styles.volver}>
        Volver al panel
      </BotonLink>
    </>
  );
}
