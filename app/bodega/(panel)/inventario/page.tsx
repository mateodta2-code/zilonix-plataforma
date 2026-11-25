import { SinAccesoBodega } from "@/components/bodega/SinAccesoBodega";
import { Boton } from "@/components/marco/Boton";
import { Campo } from "@/components/marco/Campo";
import { EncabezadoPagina } from "@/components/marco/EncabezadoPagina";
import { EstadoVacio } from "@/components/marco/EstadoVacio";
import { SkuCopiable } from "@/components/marco/SkuCopiable";
import { CeldaTabla, FilaTabla, Tabla } from "@/components/marco/Tabla";
import { accesoBodega } from "@/lib/bodega/contexto";
import { listarEmpresasQueAtiende } from "@/lib/bodega/empresas";
import { listarStockBodega } from "@/lib/bodega/inventario";
import { formatearNumero } from "@/lib/ml/sitios";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function BodegaInventarioPage({ searchParams }: { searchParams: Record<string, string | string[] | undefined> }) {
  const { decision } = await accesoBodega("bodega");
  if (!decision.ok) return <SinAccesoBodega motivo={decision.motivo} />;
  const bodegaId = decision.membresia.bodegaId;
  const busqueda = typeof searchParams.q === "string" ? searchParams.q.slice(0, 80) : "";
  const ligadas = await listarEmpresasQueAtiende(bodegaId);
  const filtroCrudo = typeof searchParams.empresa === "string" ? searchParams.empresa : "";
  const empresaId = UUID_RE.test(filtroCrudo) && ligadas.some((e) => e.empresaId === filtroCrudo) ? filtroCrudo : undefined;
  const filas = await listarStockBodega(bodegaId, { busqueda, empresaId });

  return (
    <>
      <EncabezadoPagina titulo="Inventario" descripcion="El stock de cada empresa en esta bodega, por SKU." />
      <form method="get">
        <Campo etiqueta="Buscar SKU">
          <input name="q" defaultValue={busqueda} maxLength={80} className="zx-control" />
        </Campo>
        <Campo etiqueta="Empresa">
          <select name="empresa" className="zx-control" defaultValue={empresaId ?? ""}>
            <option value="">Todas</option>
            {ligadas.map((e) => (
              <option key={e.empresaId} value={e.empresaId}>
                {e.nombre}
              </option>
            ))}
          </select>
        </Campo>
        <Boton type="submit" variante="secundario" chico>
          Buscar
        </Boton>
      </form>
      {filas.length === 0 ? (
        <EstadoVacio>No hay stock que mostrar.</EstadoVacio>
      ) : (
        <Tabla encabezados={["Empresa", "SKU", "Cantidad"]}>
          {filas.map((f) => (
            <FilaTabla key={`${f.empresaId}-${f.sku}`}>
              <CeldaTabla>
                <strong>{f.empresaNombre}</strong>
              </CeldaTabla>
              <CeldaTabla>
                <SkuCopiable sku={f.sku} />
              </CeldaTabla>
              <CeldaTabla numerica>{formatearNumero(f.cantidad, undefined)}</CeldaTabla>
            </FilaTabla>
          ))}
        </Tabla>
      )}
    </>
  );
}
