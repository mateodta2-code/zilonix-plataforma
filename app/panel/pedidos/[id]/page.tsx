import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { listarEmpresasDeUsuario } from "@/lib/empresas";
import { obtenerMiMembresia } from "@/lib/membresias";
import { obtenerOCrearUsuarioActual } from "@/lib/usuarios";
import { requierePermiso, SinPermisoError } from "@/lib/permisos";
import { tienePermiso } from "@/lib/roles";
import { tieneVentaFinanzas } from "@/lib/finanzas/ventas-consulta";
import { etiquetaEstadoPedido, obtenerPedidoConEventos, PASOS_PEDIDO, type EventoPedido, type PasoPedido } from "@/lib/ml/pedidos";
import { esUuid } from "@/lib/validacion";
import { BotonLink } from "@/components/marco/Boton";
import { EncabezadoPagina } from "@/components/marco/EncabezadoPagina";
import { SinAcceso } from "@/components/marco/SinAcceso";
import styles from "./page.module.css";

const NOMBRE_PASO: Record<PasoPedido, string> = {
  venta: "Venta",
  pago: "Pago",
  factura: "Factura",
  empaque: "Empaque",
  despacho: "Despacho",
  entrega: "Entrega",
  novedades: "Novedades",
  dinero_conciliado: "Dinero conciliado",
};

// Tarea 2.7 — línea de tiempo de los 8 pasos del plan maestro, siempre
// en el mismo orden, con o sin evento. Nunca un volcado de JSON crudo
// (evidencia real de Effi, docs/investigacion/effi.md sección H) —
// cada paso es una frase legible con fecha, hora y quién.
export default async function PedidoDetallePage({ params }: { params: { id: string } }) {
  // Bug real en vivo (digest 960283135, staging): Clerk deja
  // /sso-callback colgado relativo a la ruta donde estaba la persona al
  // iniciar sesión (returnBackUrl del middleware) — bajo esta ruta
  // dinámica, "sso-callback" se cuela como si fuera el id del pedido, y
  // pedidos.id es una columna uuid: eq(pedidos.id, "sso-callback")
  // revienta Postgres con 22P02 en vez de un redirect normal. Se corta
  // ANTES de tocar la base de datos (ni siquiera obtenerOCrearUsuarioActual) —
  // un id con forma inválida nunca puede ser un pedido real, así que no
  // hace falta averiguar nada más para saber que corresponde volver al
  // listado.
  if (!esUuid(params.id)) redirect("/panel/pedidos");

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
      <SinAcceso
        mensaje={`Tu rol (${miMembresia?.rolNombre ?? "sin rol"}) no tiene acceso a esta pantalla.`}
        volverHref="/panel/pedidos"
        volverTexto="Volver"
      />
    );
  }

  const resultado = await obtenerPedidoConEventos(empresa.id, params.id);
  if (!resultado) redirect("/panel/pedidos");
  const { pedido, eventos } = resultado;
  const eventoPorPaso = new Map<PasoPedido, EventoPedido>(eventos.map((e) => [e.paso, e]));
  // Issue #131 (Parte A) — "Ver utilidad" solo con finanzas.consultar y si
  // el pedido ya tiene foto financiera (pedidos_finanzas).
  const miMembresia = await obtenerMiMembresia(usuario.id, empresa.id);
  const verUtilidad = tienePermiso(miMembresia?.permisos ?? [], "finanzas", "consultar") && (await tieneVentaFinanzas(empresa.id, pedido.id));

  return (
    <>
      <EncabezadoPagina
        titulo={`Pedido #${pedido.pedidoIdExterno}`}
        descripcion={`${pedido.moneda} ${pedido.total} · ${etiquetaEstadoPedido(pedido.estado)}`}
      />

      <ol className={styles.linea}>
        {PASOS_PEDIDO.map((paso) => {
          const evento = eventoPorPaso.get(paso);
          return (
            <li key={paso} className={styles.paso}>
              <div className={styles.punto} data-cumplido={evento ? "true" : "false"} />
              <div>
                <div className={styles.nombrePaso} data-cumplido={evento ? "true" : "false"}>
                  {NOMBRE_PASO[paso]}
                </div>
                {evento ? (
                  <div className={styles.detallePaso}>
                    {new Date(evento.ts).toLocaleString("es-CO")} · {evento.actorTipo === "sistema" ? "Sistema / integración ML" : "Persona"}
                  </div>
                ) : (
                  <div className={styles.detallePaso}>Pendiente</div>
                )}
              </div>
            </li>
          );
        })}
      </ol>

      {verUtilidad && (
        <BotonLink href={`/panel/finanzas/ventas/${pedido.id}`} variante="secundario" chico className={styles.volver}>
          Ver utilidad
        </BotonLink>
      )}{" "}
      <BotonLink href="/panel/pedidos" variante="fantasma" chico className={styles.volver}>
        Volver a pedidos
      </BotonLink>
    </>
  );
}
