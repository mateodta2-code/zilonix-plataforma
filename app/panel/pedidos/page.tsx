import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { listarEmpresasDeUsuario } from "@/lib/empresas";
import { obtenerMiMembresia } from "@/lib/membresias";
import { obtenerOCrearUsuarioActual } from "@/lib/usuarios";
import { requierePermiso, SinPermisoError } from "@/lib/permisos";
import { obtenerCuentaMlActiva } from "@/lib/ml/cuentas";
import { BotonLink } from "@/components/marco/Boton";
import { EncabezadoPagina } from "@/components/marco/EncabezadoPagina";
import { SinAcceso } from "@/components/marco/SinAcceso";
import { DetalleDiaCuentaProducto } from "@/components/finanzas/DetalleDiaCuentaProducto";
import { Boton } from "@/components/marco/Boton";
import { Campo } from "@/components/marco/Campo";
import estilosVentas from "@/components/finanzas/ventasUtilidad.module.css";
import { normalizarParametro } from "@/lib/filtros-listado";
import { resolverRangoVentas } from "@/lib/finanzas/ventas-pantalla";
import { MARKETPLACES, PARAM_MARKETPLACE, parsearMarketplace, seccionesDeMarketplace, type Marketplace } from "@/lib/pedidos/marketplace";
import { PedidosFalabella } from "./PedidosFalabella";
import styles from "./page.module.css";

// Issue #131 — Pedidos es el «Detalle día a día · cuenta · producto»,
// el mismo de Finanzas → Ventas (components/finanzas/
// DetalleDiaCuentaProducto.tsx), sin pestañas ni lista aparte (Sharel lo
// pidió así). La ficha de cada pedido sigue en /panel/pedidos/[id]. Pide
// ventas.consultar para entrar y finanzas.consultar porque todo lo que
// se ve son montos de utilidad; sin eso, aviso y no se consulta nada.
// Sin tarjetas KPI ni «Total por cuenta» (mostrarResumen={false}):
// solo filtros, «Traer ventas de este mes» y la tabla. Los indicadores
// van a Inicio (#143/#163).
// Cualquier ?vista= viejo (lista o detalle) cae acá mismo.
//
// Issue #422 — filtro de marketplace (?marketplace=todos|ml|falabella,
// lista blanca en lib/pedidos/marketplace.ts). Mercado Libre sigue siendo
// el detalle día a día de siempre (componente compartido con Finanzas,
// sin tocarlo); Falabella es una tabla aparte, del mismo rango de fechas.

// Href de cada opción del filtro: conserva fechas, cuenta y costo, y deja
// fuera la página (cambiar de marketplace vuelve a la primera).
function hrefMarketplace(searchParams: Record<string, string | string[] | undefined>, marketplace: Marketplace): string {
  const params = new URLSearchParams();
  for (const nombre of ["cuenta", "desde", "hasta", "costo"]) {
    const valor = normalizarParametro(searchParams[nombre]);
    if (valor) params.set(nombre, valor);
  }
  if (marketplace !== "todos") params.set(PARAM_MARKETPLACE, marketplace);
  const query = params.toString();
  return query ? `/panel/pedidos?${query}` : "/panel/pedidos";
}
async function puedeConsultarConfiguracion(usuarioId: string, empresaId: string): Promise<boolean> {
  try {
    await requierePermiso(usuarioId, empresaId, "configuracion", "consultar");
    return true;
  } catch (error) {
    if (error instanceof SinPermisoError) return false;
    throw error;
  }
}

export default async function PedidosPage({ searchParams }: { searchParams: Record<string, string | string[] | undefined> }) {
  const usuario = await obtenerOCrearUsuarioActual();
  if (!usuario) redirect("/sign-in");

  const propias = await listarEmpresasDeUsuario(usuario.id);
  const empresaId = cookies().get("empresa_actual")?.value;
  const empresa = propias.find((e) => e.id === empresaId) ?? propias[0];
  if (!empresa) redirect("/crear-empresa");

  try {
    await requierePermiso(usuario.id, empresa.id, "ventas", "consultar");
    await requierePermiso(usuario.id, empresa.id, "finanzas", "consultar");
  } catch (error) {
    if (!(error instanceof SinPermisoError)) throw error;
    const miMembresia = await obtenerMiMembresia(usuario.id, empresa.id);
    return (
      <SinAcceso
        mensaje={`Tu rol (${miMembresia?.rolNombre ?? "sin rol"}) no puede ver Pedidos: muestra montos de utilidad y hace falta acceso a Ventas y a Finanzas.`}
      />
    );
  }

  // Issue #323 — el estado vacío de Pedidos tiene que decir el
  // siguiente paso concreto: si todavía no hay ninguna cuenta de
  // Mercado Libre conectada, el problema no es el rango de fechas, es
  // que no hay nada que traer. El botón a /panel/conectar-ml (pide
  // configuracion.consultar) solo sale si el rol de esta persona puede
  // entrar ahí — igual que el checklist de Inicio, nunca manda a un
  // "sin acceso".
  const cuentaActiva = await obtenerCuentaMlActiva(empresa.id);
  const puedeConectarMl = await puedeConsultarConfiguracion(usuario.id, empresa.id);
  const mensajeVacioPedidos = cuentaActiva ? (
    "Todavía no ha llegado ningún pedido en este rango de fechas."
  ) : puedeConectarMl ? (
    <span className={styles.vacioConAccion}>
      Para ver tus pedidos, primero conecta tu cuenta de Mercado Libre.
      <BotonLink href="/panel/conectar-ml" variante="secundario" chico>
        Conectar Mercado Libre
      </BotonLink>
    </span>
  ) : (
    "Para ver tus pedidos, antes hace falta conectar una cuenta de Mercado Libre."
  );

  const marketplace = parsearMarketplace(searchParams[PARAM_MARKETPLACE]);
  const secciones = seccionesDeMarketplace(marketplace);
  const extra: Record<string, string> = marketplace === "todos" ? {} : { [PARAM_MARKETPLACE]: marketplace };
  // Mismo rango (y mismo default: el mes actual) que usa el detalle de
  // Mercado Libre, para que los dos marketplaces muestren el mismo período.
  const desde = normalizarParametro(searchParams.desde);
  const hasta = normalizarParametro(searchParams.hasta);
  const rango = resolverRangoVentas(desde, hasta, new Date());

  return (
    <>
      <EncabezadoPagina
        titulo="Pedidos"
        accion={
          <BotonLink href="/panel/despachos" variante="secundario" chico>
            Despachos
          </BotonLink>
        }
      />

      <nav className={styles.filtroMarketplace} aria-label="Marketplace">
        {MARKETPLACES.map((m) => (
          <BotonLink
            key={m.valor}
            href={hrefMarketplace(searchParams, m.valor)}
            variante={m.valor === marketplace ? "secundario" : "fantasma"}
            chico
            aria-current={m.valor === marketplace ? "page" : undefined}
          >
            {m.etiqueta}
          </BotonLink>
        ))}
      </nav>

      {secciones.mercadoLibre && (
        <>
          {secciones.falabella && <h2 className={styles.tituloMarketplace}>Pedidos de Mercado Libre</h2>}
          <DetalleDiaCuentaProducto
            empresaId={empresa.id}
            usuarioId={usuario.id}
            searchParams={searchParams}
            ruta="/panel/pedidos"
            extra={extra}
            mostrarResumen={false}
            mensajeVacio={mensajeVacioPedidos}
          />
        </>
      )}

      {/* Solo Falabella: el formulario de fechas del detalle de Mercado
          Libre no se pinta, así que va uno propio con el mismo rango. */}
      {!secciones.mercadoLibre && (
        <form method="get" action="/panel/pedidos" className={estilosVentas.filtros}>
          <input type="hidden" name={PARAM_MARKETPLACE} value={marketplace} />
          <Campo etiqueta="Desde">
            <input type="date" name="desde" defaultValue={rango.rango?.desde ?? desde ?? ""} className="zx-control" />
          </Campo>
          <Campo etiqueta="Hasta">
            <input type="date" name="hasta" defaultValue={rango.rango?.hasta ?? hasta ?? ""} className="zx-control" />
          </Campo>
          <div className={estilosVentas.accionesFiltro}>
            <Boton type="submit" chico>
              Filtrar
            </Boton>
            <BotonLink href={`/panel/pedidos?${PARAM_MARKETPLACE}=${marketplace}`} variante="fantasma" chico>
              Mes actual
            </BotonLink>
          </div>
        </form>
      )}
      {!secciones.mercadoLibre && rango.error && <p className={estilosVentas.avisoError}>{rango.error}</p>}

      {secciones.falabella && rango.rango && (
        <PedidosFalabella empresaId={empresa.id} rango={{ desde: rango.rango.inicio, hastaExclusivo: rango.rango.finExclusivo }} />
      )}

      <BotonLink href="/panel" variante="fantasma" chico className={styles.volver}>
        Volver al panel
      </BotonLink>
    </>
  );
}
