import { requiereSesionSuperadmin, listarAccionesSuperadmin } from "@/lib/superadmin";
import { EncabezadoPagina } from "@/components/marco/EncabezadoPagina";
import { Tabla, FilaTabla, CeldaTabla } from "@/components/marco/Tabla";
import { EstadoVacio } from "@/components/marco/EstadoVacio";

// Solo lectura: las últimas 100 acciones hechas por cuentas superadmin.
export default async function SuperadminAuditoriaPage() {
  await requiereSesionSuperadmin();
  const acciones = await listarAccionesSuperadmin(100);

  return (
    <>
      <EncabezadoPagina titulo="Auditoría" descripcion="Últimas acciones del superadmin (solo lectura)." />
      {acciones.length === 0 ? (
        <EstadoVacio>Todavía no hay acciones registradas.</EstadoVacio>
      ) : (
        <Tabla encabezados={["Fecha (UTC)", "Acción", "Sobre", "Empresa", "Detalle"]}>
          {acciones.map((a, i) => (
            <FilaTabla key={i}>
              <CeldaTabla>{a.ts.toISOString().slice(0, 16).replace("T", " ")}</CeldaTabla>
              <CeldaTabla>{a.accion}</CeldaTabla>
              <CeldaTabla>{a.entidad}</CeldaTabla>
              <CeldaTabla>{a.empresaNombre ?? "—"}</CeldaTabla>
              <CeldaTabla>{a.detalle ?? "—"}</CeldaTabla>
            </FilaTabla>
          ))}
        </Tabla>
      )}
    </>
  );
}
