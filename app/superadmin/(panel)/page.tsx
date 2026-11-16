import { requiereSesionSuperadmin, listarEmpresasConConteo } from "@/lib/superadmin";
import { resumenGlobal } from "@/lib/superadmin-vista";
import { EncabezadoPagina } from "@/components/marco/EncabezadoPagina";
import { RejillaKpi } from "@/components/marco/RejillaKpi";
import { TarjetaKpi } from "@/components/marco/TarjetaKpi";

// Inicio del superadmin — solo cifras agregadas (decisión D8): nunca
// productos, pedidos individuales ni datos de compradores.
export default async function SuperadminInicioPage() {
  await requiereSesionSuperadmin();
  const r = resumenGlobal(await listarEmpresasConConteo());

  return (
    <>
      <EncabezadoPagina titulo="Inicio" descripcion="Cifras agregadas de toda la plataforma." />
      <RejillaKpi>
        <TarjetaKpi titulo="Empresas activas" valor={r.empresasActivas} />
        <TarjetaKpi titulo="Empresas suspendidas" valor={r.empresasSuspendidas} />
        <TarjetaKpi titulo="Miembros" valor={r.miembros} />
        <TarjetaKpi titulo="Cuentas ML" valor={r.cuentasMl} />
        <TarjetaKpi titulo="Cuentas Falabella" valor={r.cuentasFalabella} />
      </RejillaKpi>
    </>
  );
}
