import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { listarAuditoriaDeEmpresa } from "@/lib/auditoria";
import { listarEmpresasDeUsuario } from "@/lib/empresas";
import { obtenerOCrearUsuarioActual } from "@/lib/usuarios";
import { requierePermiso, SinPermisoError } from "@/lib/permisos";
import { BotonLink } from "@/components/marco/Boton";
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
export default async function ActividadPage() {
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

  const filas = await listarAuditoriaDeEmpresa(empresa.id);

  return (
    <>
      <EncabezadoPagina
        titulo={`Actividad de ${empresa.nombre}`}
        descripcion="Quién hizo qué, cuándo — nunca se le atribuye a una persona lo que hizo una integración."
      />

      {filas.length === 0 ? (
        <EstadoVacio>Todavía no hay actividad registrada.</EstadoVacio>
      ) : (
        <Tabla encabezados={["Cuándo", "Quién", "Acción", "Detalle"]}>
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
