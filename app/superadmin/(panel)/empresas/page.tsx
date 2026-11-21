import { requiereSesionSuperadmin, listarEmpresasConConteo, PLANES, ESTADOS_EMPRESA } from "@/lib/superadmin";
import { EncabezadoPagina } from "@/components/marco/EncabezadoPagina";
import { Tarjeta } from "@/components/marco/Tarjeta";
import { Tabla, FilaTabla, CeldaTabla } from "@/components/marco/Tabla";
import { EstadoVacio } from "@/components/marco/EstadoVacio";
import { Boton, BotonLink } from "@/components/marco/Boton";
import { Campo } from "@/components/marco/Campo";

// Tarea 1.11 (decisión D8) + PR B — solo cifras agregadas por empresa:
// plan, estado, miembros, cuentas conectadas y última actividad. Nunca
// productos, pedidos ni compradores. Buscador y filtros: GET con
// searchParams, el filtrado se hace acá en el servidor.
const fecha = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : "—");

export default async function SuperadminEmpresasPage({
  searchParams,
}: {
  searchParams: { q?: string; estado?: string; plan?: string };
}) {
  await requiereSesionSuperadmin();

  const q = (searchParams.q ?? "").trim().toLowerCase();
  const estado = (ESTADOS_EMPRESA as readonly string[]).includes(searchParams.estado ?? "") ? searchParams.estado : "";
  const plan = (PLANES as readonly string[]).includes(searchParams.plan ?? "") ? searchParams.plan : "";

  const todas = await listarEmpresasConConteo();
  const empresas = todas.filter(
    (e) => (!q || e.nombre.toLowerCase().includes(q)) && (!estado || e.estado === estado) && (!plan || e.plan === plan)
  );

  return (
    <>
      <EncabezadoPagina
        titulo="Empresas"
        descripcion="Solo cifras agregadas — nunca el detalle de una empresa sin que ella te conceda un acceso temporal."
      />

      <Tarjeta>
        <form method="get" style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "flex-end" }}>
          <Campo etiqueta="Buscar por nombre">
            <input name="q" className="zx-control" defaultValue={searchParams.q ?? ""} />
          </Campo>
          <Campo etiqueta="Estado">
            <select name="estado" className="zx-control" defaultValue={estado}>
              <option value="">Todos los estados</option>
              {ESTADOS_EMPRESA.map((x) => (
                <option key={x} value={x}>
                  {x}
                </option>
              ))}
            </select>
          </Campo>
          <Campo etiqueta="Plan">
            <select name="plan" className="zx-control" defaultValue={plan}>
              <option value="">Todos los planes</option>
              {PLANES.map((x) => (
                <option key={x} value={x}>
                  {x}
                </option>
              ))}
            </select>
          </Campo>
          <Boton type="submit" variante="primario">
            Filtrar
          </Boton>
        </form>
      </Tarjeta>

      {empresas.length === 0 ? (
        <EstadoVacio>No hay empresas que coincidan.</EstadoVacio>
      ) : (
        <Tabla encabezados={["Nombre", "Alta", "Plan", "Estado", "Miembros", "Cuentas ML", "Cuentas Falabella", "Última actividad", ""]}>
          {empresas.map((e) => (
            <FilaTabla key={e.id}>
              <CeldaTabla>{e.nombre}</CeldaTabla>
              <CeldaTabla>{fecha(e.creadoTs)}</CeldaTabla>
              <CeldaTabla>{e.plan}</CeldaTabla>
              <CeldaTabla>{e.estado}</CeldaTabla>
              <CeldaTabla>{e.miembros}</CeldaTabla>
              <CeldaTabla>{e.cuentasMl}</CeldaTabla>
              <CeldaTabla>{e.cuentasFalabella}</CeldaTabla>
              <CeldaTabla>{fecha(e.ultimaActividad)}</CeldaTabla>
              <CeldaTabla>
                <BotonLink href={`/superadmin/${e.id}`}>
                  Ver
                </BotonLink>
              </CeldaTabla>
            </FilaTabla>
          ))}
        </Tabla>
      )}
    </>
  );
}
