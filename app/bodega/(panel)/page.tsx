import { EncabezadoPagina } from "@/components/marco/EncabezadoPagina";
import { RejillaKpi } from "@/components/marco/RejillaKpi";
import { TarjetaKpi } from "@/components/marco/TarjetaKpi";
import { SinAccesoBodega } from "@/components/bodega/SinAccesoBodega";
import { accesoBodega } from "@/lib/bodega/contexto";
import { contarPorRol, listarMiembros } from "@/lib/bodega/miembros";

// Inicio de la bodega: su nombre y cuántas personas activas hay por rol.
export default async function BodegaInicioPage() {
  const { decision } = await accesoBodega("bodega");
  if (!decision.ok) return <SinAccesoBodega motivo={decision.motivo} />;
  const { bodegaId, bodegaNombre } = decision.membresia;
  const conteo = contarPorRol(await listarMiembros(bodegaId));

  return (
    <>
      <EncabezadoPagina titulo={bodegaNombre} descripcion="Personas activas por rol." />
      <RejillaKpi>
        <TarjetaKpi titulo="Administradores" valor={conteo.admin_bodega} />
        <TarjetaKpi titulo="Operarios" valor={conteo.operario} />
        <TarjetaKpi titulo="Domiciliarios" valor={conteo.domiciliario} />
      </RejillaKpi>
    </>
  );
}
