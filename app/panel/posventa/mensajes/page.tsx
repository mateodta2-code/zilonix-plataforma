import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { EncabezadoPagina } from "@/components/marco/EncabezadoPagina";
import { SinAcceso } from "@/components/marco/SinAcceso";
import { listarEmpresasDeUsuario } from "@/lib/empresas";
import { obtenerMiMembresia } from "@/lib/membresias";
import { listarCuentasConectadas } from "@/lib/ml/cuentas";
import { requierePermiso, SinPermisoError } from "@/lib/permisos";
import { obtenerOCrearUsuarioActual } from "@/lib/usuarios";
import { cargarVentasConMensajes, DIAS_VENTANA, TOPE_VENTAS_REVISADAS } from "./datos";
import { contarEstados, filtrarFilas, leerFiltros } from "./filtros";
import { ListaMensajes } from "./ListaMensajes";
import styles from "./Mensajes.module.css";

// Posventa-Mensajes (Refs #645) — lista de conversaciones de las ventas
// recientes. Ver pide ventas.consultar. Solo lectura y siempre con
// mark_as_read=false: abrir esta pantalla NO marca nada como leído en ML.
export default async function MensajesPosventaPage({ searchParams }: { searchParams?: Record<string, string | string[] | undefined> }) {
  const usuario = await obtenerOCrearUsuarioActual();
  if (!usuario) redirect("/sign-in");
  const propias = await listarEmpresasDeUsuario(usuario.id);
  const empresaId = cookies().get("empresa_actual")?.value;
  const empresa = propias.find((e) => e.id === empresaId) ?? propias[0];
  if (!empresa) redirect("/crear-empresa");

  try {
    await requierePermiso(usuario.id, empresa.id, "ventas", "consultar");
  } catch (error) {
    if (!(error instanceof SinPermisoError)) throw error;
    const miMembresia = await obtenerMiMembresia(usuario.id, empresa.id);
    return (
      <>
        <EncabezadoPagina titulo="Mensajes" />
        <SinAcceso mensaje={`Tu rol (${miMembresia?.rolNombre ?? "sin rol"}) no tiene acceso a este módulo.`} />
      </>
    );
  }

  const filtros = leerFiltros(searchParams ?? {});
  const cuentas = await listarCuentasConectadas(empresa.id);
  const { filas, cuentasConFalla } = await cargarVentasConMensajes(empresa.id, cuentas);
  const filtradas = filtrarFilas(filas, filtros);

  return (
    <>
      <EncabezadoPagina titulo="Mensajes" descripcion={`Conversaciones de tus ventas de los últimos ${DIAS_VENTANA} días (se revisan las ${TOPE_VENTAS_REVISADAS} más recientes por cuenta). Se leen en vivo de Mercado Libre, sin marcarlas como leídas.`} />
      {cuentas.length === 0 && <div className={styles.aviso}>Conecta una cuenta de Mercado Libre para ver los mensajes.</div>}
      {cuentasConFalla > 0 && <div className={styles.aviso}>No se pudo revisar {cuentasConFalla === 1 ? "una cuenta" : `${cuentasConFalla} cuentas`} ahora. Intenta de nuevo en un momento.</div>}
      <ListaMensajes todas={filas} filtradas={filtradas} conteos={contarEstados(filas)} filtros={filtros} />
    </>
  );
}
