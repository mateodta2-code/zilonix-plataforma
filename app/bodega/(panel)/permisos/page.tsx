import { Chip } from "@/components/marco/Chip";
import { EncabezadoPagina } from "@/components/marco/EncabezadoPagina";
import { CeldaTabla, FilaTabla, Tabla } from "@/components/marco/Tabla";
import { SinAccesoBodega } from "@/components/bodega/SinAccesoBodega";
import { accesoBodega } from "@/lib/bodega/contexto";
import { NOMBRE_ROL_BODEGA, PERMISOS_BODEGA, ROLES_BODEGA } from "@/lib/bodega/roles";

// Matriz de solo lectura: qué puede cada rol de la bodega.
export default async function BodegaPermisosPage() {
  const { decision } = await accesoBodega("bodega", { soloAdmin: true });
  if (!decision.ok) return <SinAccesoBodega motivo={decision.motivo} volverHref="/bodega" volverTexto="Volver a la bodega" />;

  return (
    <>
      <EncabezadoPagina titulo="Permisos" descripcion="Qué puede hacer cada rol (solo lectura)." />
      <Tabla encabezados={["Capacidad", ...ROLES_BODEGA.map((r) => NOMBRE_ROL_BODEGA[r])]}>
        {PERMISOS_BODEGA.map((p) => (
          <FilaTabla key={p.capacidad}>
            <CeldaTabla>{p.capacidad}</CeldaTabla>
            {ROLES_BODEGA.map((r) => (
              <CeldaTabla key={r}>
                <Chip estado={p.roles.includes(r) ? "exito" : "neutro"}>{p.roles.includes(r) ? "sí" : "no"}</Chip>
              </CeldaTabla>
            ))}
          </FilaTabla>
        ))}
      </Tabla>
    </>
  );
}
