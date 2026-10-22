import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { listarEmpresasDeUsuario } from "@/lib/empresas";
import { obtenerMiMembresia } from "@/lib/membresias";
import { obtenerOCrearUsuarioActual } from "@/lib/usuarios";
import { requierePermiso, SinPermisoError } from "@/lib/permisos";
import { contarAvisos } from "@/lib/ml/avisos";
import { BotonLink } from "@/components/marco/Boton";
import { EncabezadoPagina } from "@/components/marco/EncabezadoPagina";
import { SinAcceso } from "@/components/marco/SinAcceso";
import { TarjetaKpi } from "@/components/marco/TarjetaKpi";
import styles from "./page.module.css";

// Tarea 2.4 — "panel interno" que pide el criterio de "listo": cuántos
// avisos de Mercado Libre llegaron y cuántos ya confirmó el trabajador
// contra la API real.
export default async function AvisosMlPage() {
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
    const miMembresia = await obtenerMiMembresia(usuario.id, empresa.id);
    return <SinAcceso mensaje={`Tu rol (${miMembresia?.rolNombre ?? "sin rol"}) no tiene acceso a esta pantalla.`} />;
  }

  const conteo = await contarAvisos(empresa.id);

  return (
    <>
      <EncabezadoPagina titulo="Avisos de Mercado Libre" />

      <div className={styles.grid}>
        <TarjetaKpi titulo="Recibidos" valor={conteo.recibidos} />
        <TarjetaKpi titulo="Procesados" valor={conteo.procesados} />
        <TarjetaKpi titulo="Pendientes" valor={conteo.pendientes} />
      </div>

      <BotonLink href="/panel" variante="fantasma" chico>
        Volver al panel
      </BotonLink>
    </>
  );
}
