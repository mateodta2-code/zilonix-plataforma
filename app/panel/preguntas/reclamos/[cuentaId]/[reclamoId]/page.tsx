import { and, eq } from "drizzle-orm";
import Link from "next/link";
import { cookies } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { dbComoEmpresa } from "@/db/empresa-context";
import { pedidos } from "@/db/schema";
import { EncabezadoPagina } from "@/components/marco/EncabezadoPagina";
import { SinAcceso } from "@/components/marco/SinAcceso";
import { Tarjeta } from "@/components/marco/Tarjeta";
import { listarEmpresasDeUsuario } from "@/lib/empresas";
import { obtenerConexionIA } from "@/lib/ia/conexion";
import { obtenerMiMembresia } from "@/lib/membresias";
import { listarCuentasConectadas, obtenerAccessTokenVigente } from "@/lib/ml/cuentas";
import { motivoCuentaSinRevisar } from "@/lib/ml/preguntas";
import { obtenerDetalleReclamoMl, PATRON_ID_RECLAMO, ReclamoNoEncontradoError, type DetalleReclamoMl } from "@/lib/ml/reclamos";
import { requierePermiso, SinPermisoError } from "@/lib/permisos";
import { minutosHasta, textoPlazo } from "@/lib/preguntas/tiempo";
import { obtenerOCrearUsuarioActual } from "@/lib/usuarios";
import { esUuid } from "@/lib/validacion";
import { AccionesReclamo } from "./AccionesReclamo";
import { BotonActualizar } from "./BotonActualizar";
import { ComposerReclamo } from "./ComposerReclamo";
import { ConversacionReclamo } from "./ConversacionReclamo";
import { FichaVentaReclamo } from "./FichaVentaReclamo";
import styles from "./DetalleReclamo.module.css";
import { datosSitioMl } from "@/lib/ml/sitios";
import { formatearFechaPedido } from "@/lib/pedidos/marketplace";

// Reclamos-A (Refs #644) — detalle de un reclamo, SOLO LECTURA, en vivo
// desde Mercado Libre. Nada del comprador se guarda. Ver pide
// ventas.consultar; la cuenta del URL se valida contra las de la empresa.
export default async function DetalleReclamoPage({ params }: { params: { cuentaId: string; reclamoId: string } }) {
  if (!esUuid(params.cuentaId) || !PATRON_ID_RECLAMO.test(params.reclamoId)) notFound();

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
        <EncabezadoPagina titulo="Reclamo" />
        <SinAcceso mensaje={`Tu rol (${miMembresia?.rolNombre ?? "sin rol"}) no tiene acceso a este módulo.`} />
      </>
    );
  }

  // Cuenta de otra empresa (o inexistente): RLS no la devuelve → 404.
  const cuenta = (await listarCuentasConectadas(empresa.id)).find((c) => c.id === params.cuentaId);
  if (!cuenta) notFound();

  let detalle: DetalleReclamoMl | null = null;
  let falla: string | null = null;
  let noEncontrado = false;
  if (cuenta.desconectadaTs) {
    falla = "Token vencido — hay que reconectar la cuenta.";
  } else {
    try {
      const token = await obtenerAccessTokenVigente(empresa.id, cuenta.id);
      detalle = await obtenerDetalleReclamoMl(params.reclamoId, token, cuenta.cuentaIdExterna);
    } catch (error) {
      if (error instanceof ReclamoNoEncontradoError) noEncontrado = true;
      else {
        // Solo el nombre del error: nunca el token ni el cuerpo de ML.
        console.warn(`[panel/preguntas/reclamos] cuenta ${cuenta.id}: ${error instanceof Error ? error.name : "error"}`);
        falla = motivoCuentaSinRevisar(error);
      }
    }
  }
  if (noEncontrado) notFound();

  // Escribir pide ventas modificar; la IA, una conexión principal.
  const puedeEscribir = await requierePermiso(usuario.id, empresa.id, "ventas", "modificar").then(
    () => true,
    (error) => {
      if (error instanceof SinPermisoError) return false;
      throw error;
    }
  );
  const iaConectada = (await obtenerConexionIA(empresa.id)) !== null;

  const ahora = new Date();
  const migas = (
    <nav className={styles.migas} aria-label="Ruta">
      <Link href="/panel/preguntas">Preguntas y reclamos</Link> › <Link href="/panel/preguntas?tab=reclamos">Reclamos</Link> › Reclamo n.º {params.reclamoId}
    </nav>
  );

  if (!detalle) {
    return (
      <>
        {migas}
        <EncabezadoPagina titulo={`Reclamo n.º ${params.reclamoId}`} />
        <div className={styles.aviso}>{falla ?? "No se pudo consultar ahora. Se reintenta al actualizar."}</div>
        <BotonActualizar />
      </>
    );
  }

  // Link a la venta en Pedidos, si ya se importó a Zilonix.
  let pedidoZilonixId: string | null = null;
  if (detalle.venta.ordenId) {
    const ordenId = detalle.venta.ordenId;
    const [fila] = await dbComoEmpresa(empresa.id, (tx) =>
      tx
        .select({ id: pedidos.id })
        .from(pedidos)
        .where(and(eq(pedidos.empresaId, empresa.id), eq(pedidos.cuentaMlId, cuenta.id), eq(pedidos.pedidoIdExterno, ordenId)))
        .limit(1)
    );
    pedidoZilonixId = fila?.id ?? null;
  }

  // Reclamos-Dinero: las acciones de dinero piden ventas/modificar.
  let puedeModificar = true;
  try {
    await requierePermiso(usuario.id, empresa.id, "ventas", "modificar");
  } catch (error) {
    if (!(error instanceof SinPermisoError)) throw error;
    puedeModificar = false;
  }

  const siteId = cuenta.siteId;
  const propsAcciones = {
    estado: detalle.reclamo.estado,
    motivoId: detalle.reclamo.motivoId,
    puedeModificar,
    reclamoId: detalle.reclamo.id,
    cuentaId: cuenta.id,
    etapa: detalle.reclamo.etapa,
    accionesVendedor: detalle.accionesVendedor,
    siteId,
    ordenId: detalle.venta.ordenId,
  };
  const plazoFecha =
    detalle.plazo && Number.isFinite(Date.parse(detalle.plazo))
      ? formatearFechaPedido(new Date(detalle.plazo), datosSitioMl(siteId).moneda)
      : null;

  return (
    <>
      {migas}
      <EncabezadoPagina titulo={`Reclamo n.º ${detalle.reclamo.id}`} descripcion="Solo lectura: los datos del comprador se leen en vivo de Mercado Libre y no se guardan." />
      <div className={styles.barra}>
        <BotonActualizar />
      </div>
      <div className={styles.rejilla}>
        <div className={styles.columnaIzquierda}>
          <Tarjeta>
            <ConversacionReclamo detalle={detalle} cuentaId={cuenta.id} siteId={siteId} ahora={ahora} />
          </Tarjeta>
          {plazoFecha && (
            <p className={styles.textoPlazo}>
              Tienes hasta el {plazoFecha} ({textoPlazo(minutosHasta(detalle.plazo, ahora))}) para resolver el reclamo. Si no encuentran una solución para esa fecha, el comprador definirá cómo continuar.
            </p>
          )}
          <AccionesReclamo {...propsAcciones} />
          <ComposerReclamo {...propsAcciones} iaConectada={iaConectada} sinPermiso={!puedeEscribir} />
        </div>
        <Tarjeta>
          <FichaVentaReclamo detalle={detalle} siteId={siteId} pedidoZilonixId={pedidoZilonixId} ahora={ahora} />
        </Tarjeta>
      </div>
    </>
  );
}
