import Link from "next/link";
import { cookies } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { Chip } from "@/components/marco/Chip";
import { EncabezadoPagina } from "@/components/marco/EncabezadoPagina";
import { SinAcceso } from "@/components/marco/SinAcceso";
import { RevisarDevolucion } from "@/components/posventa/RevisarDevolucion";
import { Tarjeta } from "@/components/marco/Tarjeta";
import { listarEmpresasDeUsuario } from "@/lib/empresas";
import { obtenerMiMembresia } from "@/lib/membresias";
import { listarCuentasConectadas, obtenerAccessTokenVigente } from "@/lib/ml/cuentas";
import {
  estadoSimpleDevolucion,
  obtenerCostoEnvioDevolucionMl,
  obtenerDevolucionMl,
  obtenerRevisionesMl,
  ROTULOS_ESTADO_DEVOLUCION,
  rotuloEnvioDevolucion,
  rotuloSubtipoDevolucion,
} from "@/lib/ml/devoluciones";
import { motivoRevisionNoDisponible } from "@/lib/ml/devolucionesRevision";
import { motivoCuentaSinRevisar } from "@/lib/ml/preguntas";
import { obtenerDetalleReclamoMl, PATRON_ID_RECLAMO, ReclamoNoEncontradoError, type DetalleReclamoMl } from "@/lib/ml/reclamos";
import { datosSitioMl, formatearMonedaIso } from "@/lib/ml/sitios";
import { requierePermiso, SinPermisoError } from "@/lib/permisos";
import { formatearFechaPedido } from "@/lib/pedidos/marketplace";
import { obtenerOCrearUsuarioActual } from "@/lib/usuarios";
import { esUuid } from "@/lib/validacion";
import { FichaVentaReclamo } from "../../../reclamos/[cuentaId]/[reclamoId]/FichaVentaReclamo";
import styles from "../../Devoluciones.module.css";

// Posventa-Devoluciones (Refs #648) — detalle de una devolución, SOLO
// LECTURA, en vivo desde Mercado Libre. Nada del comprador se guarda. La
// cuenta del URL se valida contra las de la empresa (RLS) → 404 si no es.
export default async function DetalleDevolucionPage({ params }: { params: { cuentaId: string; reclamoId: string } }) {
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
    return <SinAcceso mensaje={`Tu rol (${miMembresia?.rolNombre ?? "sin rol"}) no tiene acceso a este módulo.`} />;
  }

  const cuenta = (await listarCuentasConectadas(empresa.id)).find((c) => c.id === params.cuentaId);
  if (!cuenta) notFound();

  const migas = (
    <nav className={styles.migas} aria-label="Ruta">
      <Link href="/panel/posventa">Posventa</Link> › <Link href="/panel/posventa/devoluciones">Devoluciones</Link> › Reclamo n.º {params.reclamoId}
    </nav>
  );

  let detalle: DetalleReclamoMl | null = null;
  let falla: string | null = null;
  let token: string | null = null;
  if (cuenta.desconectadaTs) {
    falla = "Token vencido — hay que reconectar la cuenta.";
  } else {
    try {
      token = await obtenerAccessTokenVigente(empresa.id, cuenta.id);
      detalle = await obtenerDetalleReclamoMl(params.reclamoId, token, cuenta.cuentaIdExterna);
    } catch (error) {
      if (error instanceof ReclamoNoEncontradoError) notFound();
      console.warn(`[panel/posventa/devoluciones] cuenta ${cuenta.id}: ${error instanceof Error ? error.name : "error"}`);
      falla = motivoCuentaSinRevisar(error);
    }
  }

  if (!detalle || !token) {
    return (
      <>
        {migas}
        <EncabezadoPagina titulo={`Devolución del reclamo n.º ${params.reclamoId}`} />
        <div className={styles.aviso}>{falla ?? "No se pudo consultar ahora. Se reintenta al actualizar."}</div>
      </>
    );
  }

  // Lecturas secundarias: si fallan, la pantalla sigue sin ese dato.
  const devolucion = await obtenerDevolucionMl(detalle.reclamo.id, token);
  const [revisiones, costo] = await Promise.all([
    devolucion?.id ? obtenerRevisionesMl(devolucion.id, token) : Promise.resolve(null),
    obtenerCostoEnvioDevolucionMl(detalle.reclamo.id, token),
  ]);
  const estado = estadoSimpleDevolucion(devolucion, revisiones);
  const sitio = datosSitioMl(cuenta.siteId);
  const fecha = (iso: string | null) => (iso && Number.isFinite(Date.parse(iso)) ? formatearFechaPedido(new Date(iso), sitio.moneda) : null);
  const subtipo = rotuloSubtipoDevolucion(devolucion?.subtipo ?? null);
  const motivo = detalle.motivo?.detalle ?? detalle.motivo?.nombre ?? detalle.reclamo.motivoId;

  // El componente tiene un solo motivo para sus dos botones: solo se
  // deshabilitan si ML no habilita ninguna de las dos revisiones (el
  // servidor vuelve a validar cada una al ejecutar).
  const sinOk = motivoRevisionNoDisponible(detalle.reclamo, "ok");
  const sinFalla = motivoRevisionNoDisponible(detalle.reclamo, "con_falla");
  const motivoRevision = !devolucion?.id ? "No se pudo leer la devolución en Mercado Libre ahora." : sinOk && sinFalla ? sinOk : null;

  const pasos = [
    { titulo: "Devolución abierta", fecha: fecha(devolucion?.creada ?? null) },
    ...(devolucion?.envios ?? []).map((e) => ({ titulo: `Envío de vuelta: ${rotuloEnvioDevolucion(e.estado)}`, fecha: null })),
    ...((revisiones ?? []).map((r) => ({ titulo: "Revisión de la devolución", fecha: fecha(r.fecha) }))),
    ...(devolucion?.cerrada ? [{ titulo: "Devolución cerrada", fecha: fecha(devolucion.cerrada) }] : []),
  ];

  return (
    <>
      {migas}
      <EncabezadoPagina titulo={`Devolución del reclamo n.º ${detalle.reclamo.id}`} descripcion="Solo lectura: los datos se leen en vivo de Mercado Libre y no se guardan." />
      <div className={styles.rejilla}>
        <div className={styles.columna}>
          <Tarjeta>
            <div className={styles.seccion}>
              <p className={styles.seccionTitulo}>Estado</p>
              <p>
                <Chip estado={estado === "revisada" ? "exito" : estado === "llego" ? "advertencia" : "neutro"}>{ROTULOS_ESTADO_DEVOLUCION[estado]}</Chip>
                {subtipo ? ` · ${subtipo}` : ""}
              </p>
              {!devolucion && <p className={styles.texto}>No se pudo leer la devolución en Mercado Libre ahora.</p>}
              <ol className={styles.lineaTiempo}>
                {pasos.map((p, i) => (
                  <li key={i} className={`${styles.paso} ${i === pasos.length - 1 ? styles.pasoActual : ""}`}>
                    <p className={styles.pasoTitulo}>{p.titulo}</p>
                    {p.fecha && <p className={styles.texto}>{p.fecha}</p>}
                  </li>
                ))}
              </ol>
            </div>
          </Tarjeta>

          <Tarjeta>
            <div className={styles.seccion}>
              <p className={styles.seccionTitulo}>Envío de vuelta</p>
              {(devolucion?.envios ?? []).length === 0 && <p className={styles.texto}>Mercado Libre no informó un envío de vuelta.</p>}
              {(devolucion?.envios ?? []).map((e, i) => (
                <p key={i} className={styles.texto}>
                  {rotuloEnvioDevolucion(e.estado)}
                  {e.seguimiento ? ` · Seguimiento ${e.seguimiento}` : ""}
                  {e.destino ? ` · Destino: ${e.destino}` : ""}
                </p>
              ))}
              <p className={styles.texto}>
                Costo del envío de vuelta: {costo ? formatearMonedaIso(costo.monto, costo.moneda ?? sitio.moneda) : "—"}
              </p>
            </div>
          </Tarjeta>

          <Tarjeta>
            <div className={styles.seccion}>
              <p className={styles.seccionTitulo}>Motivo del reclamo</p>
              <p className={styles.texto}>{motivo ?? "Motivo sin detalle"}</p>
              <p className={styles.seccionTitulo}>Revisiones</p>
              {revisiones === null || revisiones.length === 0 ? (
                <p className={styles.texto}>Todavía no hay revisiones.</p>
              ) : (
                revisiones.map((r, i) => (
                  <p key={i} className={styles.texto}>
                    {[r.estado, r.metodo, fecha(r.fecha)].filter(Boolean).join(" · ") || "Revisión sin detalle"}
                  </p>
                ))
              )}
              <div className={styles.barra}>
                <RevisarDevolucion
                  cuentaId={cuenta.id}
                  reclamoId={detalle.reclamo.id}
                  devolucionId={devolucion?.id ?? ""}
                  motivoNoDisponible={motivoRevision}
                />
                <Link href={`/panel/posventa/reclamos/${cuenta.id}/${detalle.reclamo.id}`} className={styles.enlace}>
                  Ver el reclamo en Posventa →
                </Link>
              </div>
            </div>
          </Tarjeta>
        </div>
        <Tarjeta>
          <FichaVentaReclamo detalle={detalle} siteId={cuenta.siteId} pedidoZilonixId={null} ahora={new Date()} />
        </Tarjeta>
      </div>
    </>
  );
}
