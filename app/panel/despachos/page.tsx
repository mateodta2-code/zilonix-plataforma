import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { listarEmpresasDeUsuario } from "@/lib/empresas";
import { obtenerMiMembresia } from "@/lib/membresias";
import { obtenerOCrearUsuarioActual } from "@/lib/usuarios";
import { requierePermiso, SinPermisoError } from "@/lib/permisos";
import { listarDespachosPendientes } from "@/lib/ml/despachos";
import { Boton, BotonLink } from "@/components/marco/Boton";
import { EncabezadoPagina } from "@/components/marco/EncabezadoPagina";
import { EstadoVacio } from "@/components/marco/EstadoVacio";
import { SinAcceso } from "@/components/marco/SinAcceso";
import styles from "./page.module.css";

const ETIQUETA_LOGISTIC_TYPE: Record<string, string> = {
  self_service: "Flex",
  xd_drop_off: "Places",
  cross_docking: "Colecta",
  fulfillment: "Full",
  otro: "Otro",
};

// Tarea 2.10 — lista de despachos listos para imprimir (celular
// primero), con selección múltiple para la impresión masiva. Full
// nunca aparece acá (ver lib/ml/despachos.ts: nunca queda marcado
// imprimible — Mercado Libre rechaza esa guía, no aplica despacho
// físico).
export default async function DespachosPage() {
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
    return <SinAcceso mensaje={`Tu rol (${miMembresia?.rolNombre ?? "sin rol"}) no tiene acceso a esta pantalla.`} />;
  }

  const pendientes = await listarDespachosPendientes(empresa.id);

  return (
    <>
      <EncabezadoPagina titulo="Despachos pendientes" />

      {pendientes.length === 0 ? (
        <EstadoVacio>No hay despachos pendientes de imprimir.</EstadoVacio>
      ) : (
        <form action="/api/ml/despachos/etiquetas" method="POST" target="_blank" className={styles.form}>
          <ul className={styles.lista}>
            {pendientes.map((d) => (
              <li key={d.id} className={styles.fila}>
                <label className={styles.etiquetaCheckbox}>
                  <input type="checkbox" name="shipmentId" value={d.shipmentIdExterno} defaultChecked />
                  <span className={styles.textoFila}>
                    Envío #{d.shipmentIdExterno}
                    <span className={styles.logisticType}>{ETIQUETA_LOGISTIC_TYPE[d.logisticType ?? "otro"] ?? d.logisticType}</span>
                  </span>
                </label>
              </li>
            ))}
          </ul>
          <Boton type="submit" className={styles.botonImprimir}>
            Imprimir etiquetas seleccionadas
          </Boton>
          <p className={styles.nota}>Si hay despachos de varias cuentas de Mercado Libre, selecciona primero los de una sola cuenta.</p>
        </form>
      )}

      <BotonLink href="/panel/pedidos" variante="fantasma" chico className={styles.volver}>
        Volver a pedidos
      </BotonLink>
    </>
  );
}
