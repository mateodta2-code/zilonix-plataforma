import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import Link from "next/link";
import { listarEmpresasDeUsuario } from "@/lib/empresas";
import { obtenerMiMembresia } from "@/lib/membresias";
import { obtenerOCrearUsuarioActual } from "@/lib/usuarios";
import { requierePermiso, SinPermisoError } from "@/lib/permisos";
import { listarPedidos } from "@/lib/ml/pedidos";
import { BotonLink } from "@/components/marco/Boton";
import { Chip } from "@/components/marco/Chip";
import { EncabezadoPagina } from "@/components/marco/EncabezadoPagina";
import { EstadoVacio } from "@/components/marco/EstadoVacio";
import { FilaLista, ListaFilas } from "@/components/marco/ListaFilas";
import { SinAcceso } from "@/components/marco/SinAcceso";
import styles from "./page.module.css";

// Tarea 2.7 — "lista de pedidos (celular primero)": una sola columna,
// cada pedido como una fila completa (nunca una tabla ancha que obliga
// a hacer scroll horizontal en un celular).
export default async function PedidosPage() {
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

  const pedidos = await listarPedidos(empresa.id);

  return (
    <>
      <EncabezadoPagina titulo="Pedidos" accion={<BotonLink href="/panel/despachos" variante="secundario" chico>Despachos</BotonLink>} />

      {pedidos.length === 0 ? (
        <EstadoVacio>
          Todavía no hay pedidos importados — conecta una cuenta de Mercado Libre en{" "}
          <Link href="/panel/conectar-ml">Conectar Mercado Libre</Link>.
        </EstadoVacio>
      ) : (
        <ListaFilas>
          {pedidos.map((pedido) => (
            <FilaLista key={pedido.id} href={`/panel/pedidos/${pedido.id}`}>
              <div className={styles.filaSuperior}>
                <span>#{pedido.pedidoIdExterno}</span>
                <span>
                  {pedido.moneda} {pedido.total}
                </span>
              </div>
              <div className={styles.filaInferior}>
                <span>{new Date(pedido.fecha).toLocaleString("es-CO")}</span>
                <Chip>{pedido.estado}</Chip>
              </div>
            </FilaLista>
          ))}
        </ListaFilas>
      )}

      <BotonLink href="/panel" variante="fantasma" chico className={styles.volver}>
        Volver al panel
      </BotonLink>
    </>
  );
}
