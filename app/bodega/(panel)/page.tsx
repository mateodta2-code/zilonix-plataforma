import { EncabezadoPagina } from "@/components/marco/EncabezadoPagina";
import { RejillaKpi } from "@/components/marco/RejillaKpi";
import { TarjetaKpi } from "@/components/marco/TarjetaKpi";
import { SinAccesoBodega } from "@/components/bodega/SinAccesoBodega";
import { accesoBodega } from "@/lib/bodega/contexto";
import { listarEmpresasQueAtiende } from "@/lib/bodega/empresas";
import { Chip } from "@/components/marco/Chip";
import { Tarjeta } from "@/components/marco/Tarjeta";
import { contarPorRol, listarMiembros } from "@/lib/bodega/miembros";

// Inicio de la bodega: su nombre y cuántas personas activas hay por rol.
export default async function BodegaInicioPage() {
  const { decision } = await accesoBodega("bodega");
  if (!decision.ok) return <SinAccesoBodega motivo={decision.motivo} />;
  const { bodegaId, bodegaNombre } = decision.membresia;
  const conteo = contarPorRol(await listarMiembros(bodegaId));

  const atendidas = await listarEmpresasQueAtiende(bodegaId);

  return (
    <>
      <EncabezadoPagina titulo={bodegaNombre} descripcion="Personas activas por rol." />
      <RejillaKpi>
        <TarjetaKpi titulo="Administradores" valor={conteo.admin_bodega} />
        <TarjetaKpi titulo="Operarios" valor={conteo.operario} />
        <TarjetaKpi titulo="Domiciliarios" valor={conteo.domiciliario} />
      </RejillaKpi>
      <Tarjeta>
        <h2>Empresas que atiendes</h2>
        {atendidas.length === 0 ? (
          <p>Todavía no tienes empresas ligadas. Las liga el equipo de Zilonix.</p>
        ) : (
          <ul style={{ listStyle: "none", padding: 0, display: "flex", flexDirection: "column", gap: 8 }}>
            {atendidas.map((e) => (
              <li key={e.empresaId} style={{ display: "flex", gap: 12, alignItems: "center" }}>
                <strong>{e.nombre}</strong>
                <Chip estado={e.estado === "activa" ? "exito" : "neutro"}>{e.estado === "activa" ? "Activa" : "Pausada"}</Chip>
              </li>
            ))}
          </ul>
        )}
      </Tarjeta>
    </>
  );
}
