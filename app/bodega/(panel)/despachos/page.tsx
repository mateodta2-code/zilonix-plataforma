import { AvisosUrl } from "@/components/inventario/Avisos";
import { SinAccesoBodega } from "@/components/bodega/SinAccesoBodega";
import { Boton } from "@/components/marco/Boton";
import { Campo } from "@/components/marco/Campo";
import { EncabezadoPagina } from "@/components/marco/EncabezadoPagina";
import { EstadoVacio } from "@/components/marco/EstadoVacio";
import { SkuCopiable } from "@/components/marco/SkuCopiable";
import { CeldaTabla, FilaTabla, Tabla } from "@/components/marco/Tabla";
import { Tarjeta } from "@/components/marco/Tarjeta";
import { accesoBodega } from "@/lib/bodega/contexto";
import { listarDespachosBodega } from "@/lib/bodega/despachos";
import { listarEmpresasQueAtiende } from "@/lib/bodega/empresas";
import { formatearNumero } from "@/lib/ml/sitios";
import { marcarPreparadoAction } from "./actions";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const TIPO_ENVIO: Record<string, string> = {
  self_service: "Flex",
  xd_drop_off: "Colecta",
  cross_docking: "Cross docking",
  fulfillment: "Full",
  otro: "Otro",
};

// Issue #628 (Bodega-3) — solo lo necesario para preparar: número de pedido,
// SKU, cantidad, tipo de envío y estado. Nunca datos del comprador (la
// bodega ni siquiera puede leer esas tablas).
export default async function BodegaDespachosPage({ searchParams }: { searchParams: Record<string, string | string[] | undefined> }) {
  const { decision } = await accesoBodega("bodega");
  if (!decision.ok) return <SinAccesoBodega motivo={decision.motivo} />;
  const bodegaId = decision.membresia.bodegaId;
  const ligadas = await listarEmpresasQueAtiende(bodegaId);
  const filtroCrudo = typeof searchParams.empresa === "string" ? searchParams.empresa : "";
  const empresaId = UUID_RE.test(filtroCrudo) && ligadas.some((e) => e.empresaId === filtroCrudo) ? filtroCrudo : undefined;
  const estado = searchParams.estado === "preparado" ? "preparado" : searchParams.estado === "todos" ? undefined : "pendiente";
  const despachos = await listarDespachosBodega(bodegaId, { estado, empresaId });

  return (
    <>
      <EncabezadoPagina titulo="Despachos" descripcion="Pedidos que las empresas enviaron a la bodega para preparar. Al marcar «preparado» se descuenta el stock." />
      <AvisosUrl searchParams={searchParams} />
      <Tarjeta>
        <form method="get">
          <Campo etiqueta="Estado">
            <select name="estado" className="zx-control" defaultValue={estado ?? "todos"}>
              <option value="pendiente">Por preparar</option>
              <option value="preparado">Preparados</option>
              <option value="todos">Todos</option>
            </select>
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
            Filtrar
          </Boton>
        </form>
        {despachos.length === 0 ? (
          <EstadoVacio>No hay despachos con este filtro.</EstadoVacio>
        ) : (
          <Tabla encabezados={["Pedido", "Empresa", "Envío", "SKU y cantidad", "Estado", ""]}>
            {despachos.map((d) => (
              <FilaTabla key={d.id}>
                <CeldaTabla>
                  <strong>{d.numeroPedido}</strong>
                </CeldaTabla>
                <CeldaTabla>{d.empresaNombre}</CeldaTabla>
                <CeldaTabla>{d.tipoEnvio ? (TIPO_ENVIO[d.tipoEnvio] ?? "Otro") : "—"}</CeldaTabla>
                <CeldaTabla>
                  {d.lineas.map((l) => (
                    <div key={l.sku}>
                      <SkuCopiable sku={l.sku} /> × {formatearNumero(l.cantidad, undefined)}
                    </div>
                  ))}
                </CeldaTabla>
                <CeldaTabla>{d.estado === "preparado" ? "Preparado" : "Por preparar"}</CeldaTabla>
                <CeldaTabla>
                  {d.estado === "pendiente" && (
                    <form action={marcarPreparadoAction}>
                      <input type="hidden" name="despachoId" value={d.id} />
                      <Boton type="submit" chico>
                        Marcar preparado
                      </Boton>
                    </form>
                  )}
                </CeldaTabla>
              </FilaTabla>
            ))}
          </Tabla>
        )}
      </Tarjeta>
    </>
  );
}
