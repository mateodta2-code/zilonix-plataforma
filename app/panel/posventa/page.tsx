import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { SinAcceso } from "@/components/marco/SinAcceso";
import { BarraFiltrosPosventa } from "@/components/posventa/BarraFiltrosPosventa";
import { listarEmpresasDeUsuario } from "@/lib/empresas";
import { obtenerMiMembresia } from "@/lib/membresias";
import { listarCuentasConectadas } from "@/lib/ml/cuentas";
import { leerBandejaPreguntas } from "@/lib/ml/preguntas";
import { leerCuentaMlDeQuery } from "@/lib/ml/selector-cuenta";
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
  const cuentas = (await listarCuentasConectadas(empresa.id)).filter((c) => !c.desconectadaTs).map((c) => ({ id: c.id, apodo: c.nickname }));
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

      <BarraFiltrosPosventa
        busqueda={busqueda}
        placeholder="Buscar por # de venta o motivo"
        cuentas={cuentas}
        cuentaId={cuentaId}
        extra={{ tipo: "select", nombre: "orden", etiqueta: "Ordenar por", valor: orden, opciones: ORDENES_RECLAMOS.map((o) => ({ valor: o.valor, etiqueta: o.etiqueta })) }}
      />

      <p className={styles.contador}>
        {reclamos.length} {reclamos.length === 1 ? "reclamo" : "reclamos"}
      </p>
      <ListaReclamos reclamos={reclamos} ahoraMs={Date.now()} />
    </>
  );
}
