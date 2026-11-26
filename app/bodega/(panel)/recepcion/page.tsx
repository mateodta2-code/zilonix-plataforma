import { AvisosUrl } from "@/components/inventario/Avisos";
import { SinAccesoBodega } from "@/components/bodega/SinAccesoBodega";
import { Boton } from "@/components/marco/Boton";
import { Campo } from "@/components/marco/Campo";
import { EncabezadoPagina } from "@/components/marco/EncabezadoPagina";
import { EstadoVacio } from "@/components/marco/EstadoVacio";
import { CeldaTabla, FilaTabla, Tabla } from "@/components/marco/Tabla";
import { Tarjeta } from "@/components/marco/Tarjeta";
import { accesoBodega } from "@/lib/bodega/contexto";
import { listarEmpresasQueAtiende } from "@/lib/bodega/empresas";
import { listarRecepciones } from "@/lib/bodega/recepcion";
import { formatearNumero } from "@/lib/ml/sitios";
import { registrarRecepcionAction } from "./actions";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function BodegaRecepcionPage({ searchParams }: { searchParams: Record<string, string | string[] | undefined> }) {
  const { decision } = await accesoBodega("bodega");
  if (!decision.ok) return <SinAccesoBodega motivo={decision.motivo} />;
  const bodegaId = decision.membresia.bodegaId;
  const ligadas = await listarEmpresasQueAtiende(bodegaId);
  const activas = ligadas.filter((e) => e.estado === "activa");
  const filtroCrudo = typeof searchParams.empresa === "string" ? searchParams.empresa : "";
  const empresaId = UUID_RE.test(filtroCrudo) && ligadas.some((e) => e.empresaId === filtroCrudo) ? filtroCrudo : undefined;
  const recepciones = await listarRecepciones(bodegaId, { empresaId });
  const hoy = new Date().toISOString().slice(0, 10);

  return (
    <>
      <EncabezadoPagina titulo="Recepción" descripcion="Registra la mercancía que llega para cada empresa que atiende la bodega. Suma al inventario al guardar." />
      <AvisosUrl searchParams={searchParams} />

      <Tarjeta>
        <h2>Nueva recepción</h2>
        {activas.length === 0 ? (
          <EstadoVacio>No hay empresas activas ligadas a esta bodega.</EstadoVacio>
        ) : (
          <form action={registrarRecepcionAction}>
            <Campo etiqueta="Empresa">
              <select name="empresaId" required className="zx-control" defaultValue="">
                <option value="" disabled>
                  Elige una empresa
                </option>
                {activas.map((e) => (
                  <option key={e.empresaId} value={e.empresaId}>
                    {e.nombre}
                  </option>
                ))}
              </select>
            </Campo>
            <Campo etiqueta="Fecha">
              <input type="date" name="fecha" defaultValue={hoy} className="zx-control" />
            </Campo>
            <Campo etiqueta="Nota (opcional)">
              <input name="nota" maxLength={500} className="zx-control" />
            </Campo>
            <Campo etiqueta="Líneas: un SKU y su cantidad por renglón (puedes pegar varias)">
              <textarea name="lineas" required rows={6} className="zx-control" placeholder={"SKU-001 10\nSKU-002 5"} />
            </Campo>
            <Boton type="submit">Registrar recepción</Boton>
          </form>
        )}
      </Tarjeta>

      <Tarjeta>
        <h2>Recepciones</h2>
        <form method="get">
          <Campo etiqueta="Filtrar por empresa">
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
            Filtrar
          </Boton>
        </form>
        {recepciones.length === 0 ? (
          <EstadoVacio>Todavía no hay recepciones.</EstadoVacio>
        ) : (
          <Tabla encabezados={["Fecha", "Empresa", "SKU", "Unidades", "Nota"]}>
            {recepciones.map((r) => (
              <FilaTabla key={r.id}>
                <CeldaTabla>{r.fecha.toISOString().slice(0, 10)}</CeldaTabla>
                <CeldaTabla>
                  <strong>{r.empresaNombre}</strong>
                </CeldaTabla>
                <CeldaTabla numerica>{formatearNumero(r.lineas, undefined)}</CeldaTabla>
                <CeldaTabla numerica>{formatearNumero(r.unidades, undefined)}</CeldaTabla>
                <CeldaTabla>{r.nota ?? "—"}</CeldaTabla>
              </FilaTabla>
            ))}
          </Tabla>
        )}
      </Tarjeta>
    </>
  );
}
