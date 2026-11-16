import { EncabezadoPagina } from "@/components/marco/EncabezadoPagina";
import { EstadoVacio } from "@/components/marco/EstadoVacio";
import { Tarjeta } from "@/components/marco/Tarjeta";
import { SinAccesoBodega } from "@/components/bodega/SinAccesoBodega";
import { accesoBodega } from "@/lib/bodega/contexto";

// Inicio del domiciliario: quién es, de qué bodega, y lo que viene.
export default async function DomiciliarioInicioPage() {
  const { usuario, decision } = await accesoBodega("domiciliario");
  if (!decision.ok) return <SinAccesoBodega motivo={decision.motivo} />;

  return (
    <>
      <EncabezadoPagina titulo={`Hola, ${usuario.nombre}`} descripcion={`Bodega: ${decision.membresia.bodegaNombre}`} />
      <Tarjeta>
        <EstadoVacio>Próximamente: tus entregas del día.</EstadoVacio>
      </Tarjeta>
    </>
  );
}
