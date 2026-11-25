import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { EncabezadoPagina } from "@/components/marco/EncabezadoPagina";
import { SinAcceso } from "@/components/marco/SinAcceso";
import { listarEmpresasDeUsuario } from "@/lib/empresas";
import { obtenerMiMembresia } from "@/lib/membresias";
import { BarraFiltrosPosventa } from "@/components/posventa/BarraFiltrosPosventa";
import { listarCuentasConectadas } from "@/lib/ml/cuentas";
import { leerCuentaMlDeQuery } from "@/lib/ml/selector-cuenta";
import { requierePermiso, SinPermisoError } from "@/lib/permisos";
import { obtenerOCrearUsuarioActual } from "@/lib/usuarios";
import { cargarVentasConMensajes, DIAS_VENTANA, TOPE_VENTAS_REVISADAS } from "./datos";
import { contarEstados, filtrarFilas, leerFiltros } from "./filtros";
import { ListaMensajes } from "./ListaMensajes";
import styles from "./Mensajes.module.css";
import posventa from "../Posventa.module.css";

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
  // La cuenta del query solo vale si es de ESTA empresa (RLS); si no, Todas.
  const { cuentaId } = await leerCuentaMlDeQuery(empresa.id, searchParams?.cuenta);
  // Filtrar por cuenta solo reduce las lecturas a ML, nunca agrega.
  const { filas, cuentasSinRevisar } = await cargarVentasConMensajes(empresa.id, cuentaId ? cuentas.filter((c) => c.id === cuentaId) : cuentas);
  const filtradas = filtrarFilas(filas, filtros);

  return (
    <>
      <EncabezadoPagina titulo="Mensajes" descripcion={`Conversaciones de tus ventas de los últimos ${DIAS_VENTANA} días (se revisan las ${TOPE_VENTAS_REVISADAS} más recientes por cuenta). Se leen en vivo de Mercado Libre, sin marcarlas como leídas.`} />
      {cuentas.length === 0 && <div className={styles.aviso}>Conecta una cuenta de Mercado Libre para ver los mensajes.</div>}
      {cuentasSinRevisar.length > 0 && (
        <div className={posventa.aviso}>
          <p className={posventa.avisoTitulo}>No se pudieron revisar estas cuentas de Mercado Libre:</p>
          <ul className={posventa.avisoLista}>
            {cuentasSinRevisar.map((c) => (
              <li key={c.nickname}>
                <strong>{c.nickname}</strong> — {c.motivo}
              </li>
            ))}
          </ul>
        </div>
      )}
      <ListaMensajes todas={filas} filtradas={filtradas} conteos={contarEstados(filas)} filtros={filtros}
        cuentaId={cuentaId}
        barra={
          <BarraFiltrosPosventa
            busqueda={filtros.q}
            placeholder="N.º de venta o producto"
            cuentas={cuentas.filter((c) => !c.desconectadaTs).map((c) => ({ id: c.id, apodo: c.nickname }))}
            cuentaId={cuentaId}
            extra={{ tipo: "fecha", nombre: "desde", etiqueta: "Desde", valor: filtros.desde ?? "" }}
            ocultos={{ estado: filtros.estado }}
          />
        }
      />
    </>
  );
}
