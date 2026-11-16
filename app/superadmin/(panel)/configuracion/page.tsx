import { requiereSesionSuperadmin } from "@/lib/superadmin";
import { INACTIVIDAD_SUPERADMIN_MS } from "@/lib/superadmin-sesion";
import { EncabezadoPagina } from "@/components/marco/EncabezadoPagina";
import { RejillaKpi } from "@/components/marco/RejillaKpi";
import { TarjetaKpi } from "@/components/marco/TarjetaKpi";

// Solo lectura: se cambia con variables de entorno, no desde la pantalla.
export default async function SuperadminConfiguracionPage() {
  await requiereSesionSuperadmin();
  const exige2fa = process.env.SUPERADMIN_EXIGIR_2FA === "true";
  const minutos = Math.round(INACTIVIDAD_SUPERADMIN_MS / 60000);

  return (
    <>
      <EncabezadoPagina titulo="Configuración" descripcion="Cómo está protegido el acceso de superadmin (solo lectura)." />
      <RejillaKpi>
        <TarjetaKpi titulo="2FA exigido" valor={exige2fa ? "Sí" : "No"} />
        <TarjetaKpi titulo="Sesión" valor={`${minutos} min`} detalle={["Vence por inactividad."]} />
      </RejillaKpi>
    </>
  );
}
