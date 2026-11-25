import { EncabezadoPagina } from "@/components/marco/EncabezadoPagina";
import { SinAccesoBodega } from "@/components/bodega/SinAccesoBodega";
import { accesoBodega } from "@/lib/bodega/contexto";
import { listarMisEntregas } from "@/lib/entregas/entregas";
import { ListaMisEntregas } from "./entregas/ListaMisEntregas";

export const dynamic = "force-dynamic";

// Inicio del domiciliario: quién es, de qué bodega, y lo que viene.
export default async function DomiciliarioInicioPage() {
  const { usuario, decision } = await accesoBodega("domiciliario");
  if (!decision.ok) return <SinAccesoBodega motivo={decision.motivo} />;

  const entregas = await listarMisEntregas(decision.membresia.bodegaId, usuario.id);
  return (
    <>
      <EncabezadoPagina titulo={`Hola, ${usuario.nombre}`} descripcion={`Bodega: ${decision.membresia.bodegaNombre}`} />
      <ListaMisEntregas entregas={entregas} ahora={Date.now()} />
    </>
  );
}
