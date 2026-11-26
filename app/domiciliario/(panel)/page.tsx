import { EncabezadoPagina } from "@/components/marco/EncabezadoPagina";
import { SinAccesoBodega } from "@/components/bodega/SinAccesoBodega";
import { accesoBodega } from "@/lib/bodega/contexto";
import { listarMisEntregas } from "@/lib/entregas/entregas";
import { listarMisNovedades } from "@/lib/entregas/novedades";
import { ListaMisEntregas } from "./entregas/ListaMisEntregas";

export const dynamic = "force-dynamic";

// Inicio del domiciliario: quién es, de qué bodega, y lo que viene.
export default async function DomiciliarioInicioPage() {
  const { usuario, decision } = await accesoBodega("domiciliario");
  if (!decision.ok) return <SinAccesoBodega motivo={decision.motivo} />;

  const [entregas, novedades] = await Promise.all([
    listarMisEntregas(decision.membresia.bodegaId, usuario.id),
    listarMisNovedades(decision.membresia.bodegaId, usuario.id),
  ]);
  return (
    <>
      <EncabezadoPagina titulo={`Hola, ${usuario.nombre}`} descripcion={`Bodega: ${decision.membresia.bodegaNombre}. Para marcar «Entregado» toma una foto del paquete entregado o de quien lo recibe. Si algo pasa en el camino, usa «Reportar novedad»: la entrega sigue abierta.`} />
      <ListaMisEntregas entregas={entregas} novedades={novedades} ahora={Date.now()} />
    </>
  );
}
