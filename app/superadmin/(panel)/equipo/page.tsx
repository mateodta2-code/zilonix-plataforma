import { requiereSesionSuperadmin } from "@/lib/superadmin";
import { parsearCorreosSuperadmin } from "@/lib/superadmin-sesion";
import { enmascararCorreo } from "@/lib/superadmin-vista";
import { EncabezadoPagina } from "@/components/marco/EncabezadoPagina";
import { Tabla, FilaTabla, CeldaTabla } from "@/components/marco/Tabla";
import { EstadoVacio } from "@/components/marco/EstadoVacio";

// Solo lectura: los correos autorizados salen de SUPERADMIN_CORREOS y se
// muestran enmascarados. Para cambiarlos hay que cambiar la variable.
export default async function SuperadminEquipoPage() {
  await requiereSesionSuperadmin();
  const correos = parsearCorreosSuperadmin(process.env.SUPERADMIN_CORREOS).map(enmascararCorreo);

  return (
    <>
      <EncabezadoPagina titulo="Equipo superadmin" descripcion="Cuentas autorizadas (solo lectura). Los correos se muestran enmascarados." />
      {correos.length === 0 ? (
        <EstadoVacio>No hay correos configurados.</EstadoVacio>
      ) : (
        <Tabla encabezados={["Correo"]}>
          {correos.map((c, i) => (
            <FilaTabla key={i}>
              <CeldaTabla>{c}</CeldaTabla>
            </FilaTabla>
          ))}
        </Tabla>
      )}
    </>
  );
}
