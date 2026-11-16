import { Chip } from "@/components/marco/Chip";
import { EncabezadoPagina } from "@/components/marco/EncabezadoPagina";
import { EstadoVacio } from "@/components/marco/EstadoVacio";
import { CeldaTabla, FilaTabla, Tabla } from "@/components/marco/Tabla";
import { SinAccesoBodega } from "@/components/bodega/SinAccesoBodega";
import { accesoBodega } from "@/lib/bodega/contexto";
import { listarMiembros } from "@/lib/bodega/miembros";

export default async function BodegaDomiciliariosPage() {
  const { decision } = await accesoBodega("bodega");
  if (!decision.ok) return <SinAccesoBodega motivo={decision.motivo} />;
  const domiciliarios = (await listarMiembros(decision.membresia.bodegaId)).filter((m) => m.rol === "domiciliario");

  return (
    <>
      <EncabezadoPagina titulo="Domiciliarios" descripcion="Las personas con rol domiciliario en esta bodega." />
      {domiciliarios.length === 0 ? (
        <EstadoVacio>Todavía no hay domiciliarios.</EstadoVacio>
      ) : (
        <Tabla encabezados={["Persona", "Estado"]}>
          {domiciliarios.map((m) => (
            <FilaTabla key={m.miembroId}>
              <CeldaTabla>
                <strong>{m.nombre}</strong>
              </CeldaTabla>
              <CeldaTabla>
                <Chip estado={m.activo ? "exito" : "neutro"}>{m.activo ? "activo" : "desactivado"}</Chip>
              </CeldaTabla>
            </FilaTabla>
          ))}
        </Tabla>
      )}
    </>
  );
}
