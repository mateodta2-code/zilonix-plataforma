import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { SinAcceso } from "@/components/marco/SinAcceso";
import { Boton } from "@/components/marco/Boton";
import { SelectorCuentaMl } from "@/components/SelectorCuentaMl";
import { listarEmpresasDeUsuario } from "@/lib/empresas";
import { obtenerMiMembresia } from "@/lib/membresias";
import { leerBandejaPreguntas } from "@/lib/ml/preguntas";
import { leerCuentaMlDeQuery, PARAM_CUENTA } from "@/lib/ml/selector-cuenta";
import { requierePermiso, SinPermisoError } from "@/lib/permisos";
import { obtenerOCrearUsuarioActual } from "@/lib/usuarios";
import { AutoRefrescoDespachos } from "../despachos/AutoRefrescoDespachos";
import { filtrarYOrdenarReclamos, leerOrdenReclamos, ListaReclamos, ORDENES_RECLAMOS } from "./ListaReclamos";
import styles from "./Posventa.module.css";

// Posventa-0 (Refs #647) — pestaña «Reclamos y mediaciones». Lee en vivo
// de Mercado Libre, solo lectura. El layout ya filtra por permiso, pero
// la página lo vuelve a exigir: un layout no protege a sus hijos.

type Params = { cuenta?: string | string[]; q?: string | string[]; orden?: string | string[] };

export default async function PosventaReclamosPage({ searchParams }: { searchParams?: Params }) {
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
  const orden = leerOrdenReclamos(searchParams?.orden);
  // La cuenta del query solo vale si es de ESTA empresa (RLS); si no, Todas.
  const { cuentaId } = await leerCuentaMlDeQuery(empresa.id, searchParams?.cuenta);
  const bandeja = await leerBandejaPreguntas(empresa.id);
  const reclamos = filtrarYOrdenarReclamos(bandeja.reclamos, { cuentaId, busqueda, orden });

  return (
    <>
      <AutoRefrescoDespachos />

      {bandeja.cuentasSinRevisar.length > 0 && (
        <div className={styles.aviso}>
          <p className={styles.avisoTitulo}>No se pudieron revisar estas cuentas de Mercado Libre:</p>
          <ul className={styles.avisoLista}>
            {bandeja.cuentasSinRevisar.map((c) => (
              <li key={c.nickname}>
                <strong>{c.nickname}</strong> — {c.motivo}
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className={styles.herramientas}>
        <SelectorCuentaMl empresaId={empresa.id} cuenta={searchParams?.cuenta} parametros={{ q: busqueda, orden }} />
        <form method="get" className={styles.buscador}>
          {cuentaId ? <input type="hidden" name={PARAM_CUENTA} value={cuentaId} /> : null}
          <input type="search" name="q" defaultValue={busqueda} placeholder="Buscar por # de venta o motivo" maxLength={80} className="zx-control" />
          <label htmlFor="orden-reclamos" className={styles.texto}>
            Filtrar y ordenar
          </label>
          <select id="orden-reclamos" name="orden" defaultValue={orden} className="zx-control">
            {ORDENES_RECLAMOS.map((o) => (
              <option key={o.valor} value={o.valor}>
                {o.etiqueta}
              </option>
            ))}
          </select>
          <Boton type="submit">Buscar</Boton>
        </form>
      </div>

      <p className={styles.contador}>
        {reclamos.length} {reclamos.length === 1 ? "reclamo" : "reclamos"}
      </p>
      <ListaReclamos reclamos={reclamos} ahoraMs={Date.now()} />
    </>
  );
}
