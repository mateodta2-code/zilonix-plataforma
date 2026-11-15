import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { listarEmpresasDeUsuario } from "@/lib/empresas";
import { obtenerMiMembresia } from "@/lib/membresias";
import { obtenerOCrearUsuarioActual } from "@/lib/usuarios";
import { requierePermiso, SinPermisoError } from "@/lib/permisos";
import { listarCuentasConectadas } from "@/lib/falabella/cuentas";
import { listarPedidos } from "@/lib/falabella/pedidos";
import { BotonLink, clasesBoton } from "@/components/marco/Boton";
import { Campo } from "@/components/marco/Campo";
import { Chip } from "@/components/marco/Chip";
import { EncabezadoPagina } from "@/components/marco/EncabezadoPagina";
import { EstadoVacio } from "@/components/marco/EstadoVacio";
import { FilaLista, ListaFilas } from "@/components/marco/ListaFilas";
import { SinAcceso } from "@/components/marco/SinAcceso";
import { conectarCuentaFalabella, desconectarCuentaFalabella, sincronizarPedidosFalabella } from "./actions";
import styles from "./page.module.css";

// Adelanta la tarea 5.1 del plan técnico (decisión confirmada con
// Mateo/Debora, 15/11) — primer corte, a propósito acotado a "conectar la
// cuenta y ver los pedidos reales" (ver lib/conectores/falabella.ts).
//
// Mismo mapa de códigos fijos que /panel/conectar-ml, nunca el texto
// crudo de un error en la URL (ver nota en actions.ts).
const MENSAJES_ERROR: Record<string, string> = {
  faltan_datos: "Faltan datos — UserID (correo), API Key y Seller ID son obligatorios.",
  cuenta_en_otra_empresa: "Esta cuenta de Falabella ya está conectada a otra empresa en Zilonix. Desconéctala allá primero o escríbenos a soporte.",
  error_desconocido: "No se pudo conectar la cuenta — revisá el UserID y la API Key e intentá de nuevo.",
};
const MENSAJE_ERROR_POR_DEFECTO = "No se pudo conectar la cuenta — intentá de nuevo en un momento.";

export default async function ConectarFalabellaPage({ searchParams }: { searchParams: { conectado?: string; error?: string } }) {
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
    return (
      <>
        <EncabezadoPagina titulo="Conectar Falabella" />
        <SinAcceso mensaje={`Tu rol (${miMembresia?.rolNombre ?? "sin rol"}) no tiene acceso a esta pantalla.`} />
      </>
    );
  }

  const cuentas = await listarCuentasConectadas(empresa.id);
  const pedidos = await listarPedidos(empresa.id);

  return (
    <>
      <EncabezadoPagina titulo="Conectar Falabella" />

      {searchParams.conectado && <div className={styles.avisoExito}>Cuenta conectada.</div>}
      {searchParams.error && (
        <div className={styles.avisoError}>
          <p className={styles.avisoErrorTexto}>{MENSAJES_ERROR[searchParams.error] ?? MENSAJE_ERROR_POR_DEFECTO}</p>
        </div>
      )}

      <div className={styles.avisoInfo}>
        Falabella no usa un botón de 1 clic como Mercado Libre — hay que entrar a Falabella Seller Center (
        <a href="https://sellercenter.falabella.com" target="_blank" rel="noreferrer">
          sellercenter.falabella.com
        </a>
        ), ir a «Mi cuenta → Usuarios» y copiar el correo (UserID) y la API Key de ahí.
      </div>

      {cuentas.length === 0 && <EstadoVacio>Todavía no tienes ninguna cuenta de Falabella conectada.</EstadoVacio>}

      {cuentas.length > 0 && (
        <ListaFilas>
          {cuentas.map((cuenta) => {
            const pedidosDeLaCuenta = pedidos.filter((p) => p.cuentaFalabellaId === cuenta.id);
            return (
              <FilaLista key={cuenta.id}>
                <div className={styles.filaCuenta}>
                  <span>
                    Conectado como <strong>{cuenta.nickname}</strong> ({cuenta.userId})
                    {cuenta.desconectadaTs && <Chip>Desconectada</Chip>}
                  </span>
                  {!cuenta.desconectadaTs && (
                    <form action={desconectarCuentaFalabella.bind(null, cuenta.id)}>
                      <button type="submit" className={styles.desconectar}>
                        Desconectar
                      </button>
                    </form>
                  )}
                </div>
                {!cuenta.desconectadaTs && (
                  <form action={sincronizarPedidosFalabella.bind(null, cuenta.id)} className={styles.formSincronizar}>
                    <button type="submit" className={clasesBoton("secundario")}>
                      Sincronizar pedidos (últimos 60 días)
                    </button>
                  </form>
                )}
                <div className={styles.detallePedidos}>{pedidosDeLaCuenta.length} pedido(s) importado(s).</div>
              </FilaLista>
            );
          })}
        </ListaFilas>
      )}

      <form action={conectarCuentaFalabella} className={styles.formConectar}>
        <Campo etiqueta="UserID (correo de Seller Center)">
          <input type="email" name="userId" required className="zx-control" />
        </Campo>
        <Campo etiqueta="API Key">
          <input type="password" name="apiKey" required className="zx-control" />
        </Campo>
        <Campo etiqueta="Seller ID (nombre de tu tienda en Seller Center)">
          <input type="text" name="sellerId" required className="zx-control" />
        </Campo>
        <Campo etiqueta="Nombre para identificarla en Zilonix (opcional)">
          <input type="text" name="nickname" className="zx-control" />
        </Campo>
        <button type="submit" className={clasesBoton("primario")}>
          Conectar Falabella
        </button>
      </form>

      {pedidos.length > 0 && (
        <ListaFilas>
          {pedidos.map((pedido) => (
            <FilaLista key={pedido.id}>
              <div className={styles.filaPedido}>
                <span>{pedido.pedidoIdExterno}</span>
                <span>{pedido.estado}</span>
                <span>
                  {pedido.moneda} {pedido.total}
                </span>
                <span>{new Date(pedido.fecha).toLocaleDateString("es-CO")}</span>
              </div>
            </FilaLista>
          ))}
        </ListaFilas>
      )}

      <BotonLink href="/panel" variante="fantasma" chico>
        Volver al panel
      </BotonLink>
    </>
  );
}
