import { requiereSesionSuperadmin } from "@/lib/superadmin";
import { listarBodegas } from "@/lib/superadmin-bodegas";
import { Boton, BotonLink } from "@/components/marco/Boton";
import { Campo } from "@/components/marco/Campo";
import { EncabezadoPagina } from "@/components/marco/EncabezadoPagina";
import { EstadoVacio } from "@/components/marco/EstadoVacio";
import { CeldaTabla, FilaTabla, Tabla } from "@/components/marco/Tabla";
import { Tarjeta } from "@/components/marco/Tarjeta";
import { crearBodegaAction } from "./actions";

const fecha = (d: Date) => d.toISOString().slice(0, 10);

// Bodegas 3PL: lista con conteos por rol (nunca quiénes son) y alta.
export default async function SuperadminBodegasPage({ searchParams }: { searchParams: { error?: string } }) {
  await requiereSesionSuperadmin();
  const bodegas = await listarBodegas();

  return (
    <>
      <EncabezadoPagina titulo="Bodegas" descripcion="Operadores logísticos (3PL). Solo cifras: cuántas personas hay por rol." />
      {searchParams.error && <p>{searchParams.error}</p>}

      <Tarjeta>
        <form action={crearBodegaAction} style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "flex-end" }}>
          <Campo etiqueta="Nombre de la bodega">
            <input name="nombre" required maxLength={120} className="zx-control" />
          </Campo>
          <Campo etiqueta="NIT (opcional)">
            <input name="nit" maxLength={40} className="zx-control" />
          </Campo>
          <Boton type="submit">Crear bodega</Boton>
        </form>
      </Tarjeta>

      {bodegas.length === 0 ? (
        <EstadoVacio>Todavía no hay bodegas.</EstadoVacio>
      ) : (
        <Tabla encabezados={["Nombre", "Alta", "Estado", "Admins", "Operarios", "Domiciliarios", ""]}>
          {bodegas.map((b) => (
            <FilaTabla key={b.id}>
              <CeldaTabla>{b.nombre}</CeldaTabla>
              <CeldaTabla>{fecha(b.creadoTs)}</CeldaTabla>
              <CeldaTabla>{b.estado}</CeldaTabla>
              <CeldaTabla>{b.admins}</CeldaTabla>
              <CeldaTabla>{b.operarios}</CeldaTabla>
              <CeldaTabla>{b.domiciliarios}</CeldaTabla>
              <CeldaTabla>
                <BotonLink href={`/superadmin/bodegas/${b.id}`}>
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
