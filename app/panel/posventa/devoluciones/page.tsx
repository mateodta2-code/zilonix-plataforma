import Link from "next/link";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { SinAcceso } from "@/components/marco/SinAcceso";
import { BarraFiltrosPosventa } from "@/components/posventa/BarraFiltrosPosventa";
import { listarEmpresasDeUsuario } from "@/lib/empresas";
import { obtenerMiMembresia } from "@/lib/membresias";
import { listarCuentasConectadas } from "@/lib/ml/cuentas";
import { cargarDevolucionesEmpresa, leerProductosDeFilas, ROTULOS_ESTADO_DEVOLUCION } from "@/lib/ml/devoluciones";
import { leerCuentaMlDeQuery, PARAM_CUENTA } from "@/lib/ml/selector-cuenta";
import { requierePermiso, SinPermisoError } from "@/lib/permisos";
import { desdePeriodoMs, leerPeriodoDias, PERIODOS_DIAS } from "@/lib/posventa/metricasDevoluciones";
import { obtenerOCrearUsuarioActual } from "@/lib/usuarios";
import { contarPorEstado, ESTADOS_FILTRO, filtrarDevoluciones, leerEstadoFiltro, ListaDevoluciones, TAMANO_PAGINA_LISTA } from "./ListaDevoluciones";
import styles from "./Devoluciones.module.css";
import posventa from "../Posventa.module.css";

// Posventa-Devoluciones (Refs #648) — lista solo lectura, en vivo desde
// Mercado Libre. El layout ya filtra por permiso, pero un layout no
// protege a sus hijos: se vuelve a exigir acá.

type Params = { cuenta?: string | string[]; q?: string | string[]; estado?: string | string[]; dias?: string | string[]; pagina?: string | string[] };

export default async function DevolucionesPage({ searchParams }: { searchParams?: Params }) {
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

  const busqueda = (typeof searchParams?.q === "string" ? searchParams.q : "").slice(0, 80);
  const dias = leerPeriodoDias(searchParams?.dias);
  const estado = leerEstadoFiltro(searchParams?.estado);
  const paginaPedida = Number(typeof searchParams?.pagina === "string" ? searchParams.pagina : "1");
  // La cuenta del query solo vale si es de ESTA empresa (RLS); si no, Todas.
  const { cuentaId } = await leerCuentaMlDeQuery(empresa.id, searchParams?.cuenta);
  const cuentas = (await listarCuentasConectadas(empresa.id)).filter((c) => !c.desconectadaTs).map((c) => ({ id: c.id, apodo: c.nickname }));

  const carga = await cargarDevolucionesEmpresa(empresa.id, { cuentaId, desdeMs: desdePeriodoMs(dias, Date.now()) });
  const conteos = contarPorEstado(carga.filas);
  const filtradas = filtrarDevoluciones(carga.filas, { busqueda, estado });
  const paginas = Math.max(1, Math.ceil(filtradas.length / TAMANO_PAGINA_LISTA));
  const pagina = Number.isInteger(paginaPedida) && paginaPedida >= 1 ? Math.min(paginaPedida, paginas) : 1;
  const visibles = filtradas.slice((pagina - 1) * TAMANO_PAGINA_LISTA, pagina * TAMANO_PAGINA_LISTA);
  const productos = await leerProductosDeFilas(empresa.id, visibles);

  const consulta = (extra: Record<string, string | null>) => {
    const q = new URLSearchParams();
    const base: Record<string, string | null> = { [PARAM_CUENTA]: cuentaId, q: busqueda || null, estado, dias: String(dias), pagina: null, ...extra };
    for (const [k, v] of Object.entries(base)) if (v) q.set(k, v);
    const texto = q.toString();
    return `/panel/posventa/devoluciones${texto ? `?${texto}` : ""}`;
  };

  return (
    <>
      {carga.cuentasSinRevisar.length > 0 && (
        <div className={posventa.aviso}>
          <p className={posventa.avisoTitulo}>No se pudieron revisar estas cuentas de Mercado Libre:</p>
          <ul className={posventa.avisoLista}>
            {carga.cuentasSinRevisar.map((c) => (
              <li key={c.nickname}>
                <strong>{c.nickname}</strong> — {c.motivo}
              </li>
            ))}
          </ul>
        </div>
      )}
      {carga.truncado && <div className={styles.aviso}>Se muestran las {carga.filas.length} devoluciones más recientes del periodo.</div>}

      <div className={styles.tarjetas}>
        {ESTADOS_FILTRO.map((e) => (
          <Link key={e} href={consulta({ estado: estado === e ? null : e })} className={styles.tarjetaEstado} data-activa={estado === e}>
            <span className={styles.tarjetaNumero}>{conteos[e]}</span>
            <span className={styles.tarjetaTexto}>{ROTULOS_ESTADO_DEVOLUCION[e]}</span>
          </Link>
        ))}
      </div>

      <BarraFiltrosPosventa
        busqueda={busqueda}
        placeholder="Buscar por # de venta o motivo"
        cuentas={cuentas}
        cuentaId={cuentaId}
        extra={{ tipo: "select", nombre: "dias", etiqueta: "Periodo", valor: String(dias), opciones: PERIODOS_DIAS.map((d) => ({ valor: String(d), etiqueta: `Últimos ${d} días` })) }}
        ocultos={{ estado }}
      />
      <div className={posventa.herramientas}>
        <Link href={`/panel/posventa/devoluciones/metricas?dias=${dias}${cuentaId ? `&${PARAM_CUENTA}=${cuentaId}` : ""}`} className={styles.enlace}>
          Ver métricas →
        </Link>
      </div>

      <p className={posventa.contador}>
        {filtradas.length} {filtradas.length === 1 ? "devolución" : "devoluciones"}
      </p>
      <ListaDevoluciones filas={visibles} productos={productos} />

      {paginas > 1 && (
        <nav className={styles.paginacion} aria-label="Paginación">
          {pagina > 1 ? <Link href={consulta({ pagina: String(pagina - 1) })}>← Anterior</Link> : <span />}
          <span>
            Página {pagina} de {paginas}
          </span>
          {pagina < paginas ? <Link href={consulta({ pagina: String(pagina + 1) })}>Siguiente →</Link> : <span />}
        </nav>
      )}
    </>
  );
}
