import { requiereSesionSuperadmin, listarEmpresasConConteo } from "@/lib/superadmin";
import { listarBodegas } from "@/lib/superadmin-bodegas";
import { calcularMetricas } from "@/lib/superadmin-metricas";
import { PLANES } from "@/lib/superadmin";
import { EncabezadoPagina } from "@/components/marco/EncabezadoPagina";
import { RejillaKpi } from "@/components/marco/RejillaKpi";
import { TarjetaKpi } from "@/components/marco/TarjetaKpi";
import { CeldaTabla, FilaTabla, Tabla } from "@/components/marco/Tabla";

// Métricas del superadmin — solo conteos (decisión D8): nunca productos,
// pedidos individuales ni datos de compradores.
export default async function SuperadminMetricasPage() {
  await requiereSesionSuperadmin();
  const m = calcularMetricas(await listarEmpresasConConteo(), await listarBodegas(), new Date());

  return (
    <>
      <EncabezadoPagina titulo="Métricas" descripcion="Cifras generales de la plataforma. Solo conteos." />
      <RejillaKpi>
        <TarjetaKpi titulo="Empresas activas" valor={m.empresasActivas} />
        <TarjetaKpi titulo="Empresas suspendidas" valor={m.empresasSuspendidas} />
        <TarjetaKpi titulo="Empresas con cuenta ML" valor={m.empresasConMl} />
        <TarjetaKpi titulo="Empresas con Falabella" valor={m.empresasConFalabella} />
        <TarjetaKpi titulo="Miembros" valor={m.miembros} />
        <TarjetaKpi titulo="Bodegas activas" valor={m.bodegasActivas} />
      </RejillaKpi>

      <Tabla encabezados={["Plan", "Empresas"]}>
        {PLANES.map((p) => (
          <FilaTabla key={p}>
            <CeldaTabla>{p}</CeldaTabla>
            <CeldaTabla>{m.empresasPorPlan[p]}</CeldaTabla>
          </FilaTabla>
        ))}
      </Tabla>

      <Tabla encabezados={["Semana (desde el lunes)", "Empresas creadas"]}>
        {m.empresasPorSemana.map((s) => (
          <FilaTabla key={s.inicio}>
            <CeldaTabla>{s.inicio}</CeldaTabla>
            <CeldaTabla>{s.empresas}</CeldaTabla>
          </FilaTabla>
        ))}
      </Tabla>
    </>
  );
}
