import { listarSaludConexiones, requiereSesionSuperadmin } from "@/lib/superadmin";
import { HORAS_AVISO_ATRASADO, HORAS_SIN_RENOVAR, ordenarPorProblemas, problemasDe, resumirSalud } from "@/lib/superadmin-salud";
import { EncabezadoPagina } from "@/components/marco/EncabezadoPagina";
import { RejillaKpi } from "@/components/marco/RejillaKpi";
import { TarjetaKpi } from "@/components/marco/TarjetaKpi";
import { Tabla, FilaTabla, CeldaTabla } from "@/components/marco/Tabla";
import { EstadoVacio } from "@/components/marco/EstadoVacio";
import { BotonLink } from "@/components/marco/Boton";
import { Chip } from "@/components/marco/Chip";

// Salud de conexiones (25-nov): para ver qué empresas tienen Mercado Libre
// o Falabella caídos antes de que el cliente reclame. Solo conteos
// (decisión D8). Por defecto, solo las empresas con algún problema;
// ?todas=1 muestra todas.
const n = (v: number) => (v > 0 ? <Chip estado="peligro">{v}</Chip> : "0");

export default async function SuperadminConexionesPage({ searchParams }: { searchParams: { todas?: string } }) {
  await requiereSesionSuperadmin();
  const todas = searchParams.todas === "1";
  const filas = ordenarPorProblemas(await listarSaludConexiones());
  const r = resumirSalud(filas);
  const visibles = todas ? filas : filas.filter((f) => problemasDe(f) > 0);

  return (
    <>
      <EncabezadoPagina
        titulo="Conexiones"
        descripcion={`Cuentas de Mercado Libre y Falabella con problemas, por empresa. Solo conteos. «Por revisar»: token sin renovarse hace más de ${HORAS_SIN_RENOVAR} h. «Avisos atrasados»: avisos de Mercado Libre sin procesar después de ${HORAS_AVISO_ATRASADO} h. Las empresas suspendidas no cuentan como problema.`}
        accion={
          <BotonLink href={todas ? "/superadmin/conexiones" : "/superadmin/conexiones?todas=1"} variante="fantasma">
            {todas ? "Ver solo con problemas" : "Ver todas las empresas"}
          </BotonLink>
        }
      />
      <RejillaKpi>
        <TarjetaKpi titulo="Empresas con problemas" valor={r.empresasConProblemas} />
        <TarjetaKpi titulo="Cuentas ML desconectadas" valor={r.mlDesconectadas} />
        <TarjetaKpi titulo="Cuentas ML por revisar" valor={r.mlSinRenovar} />
        <TarjetaKpi titulo="Avisos atrasados" valor={r.avisosAtrasados} />
        <TarjetaKpi titulo="Publicidad con error" valor={r.publicidadConError} />
        <TarjetaKpi titulo="Falabella desconectadas" valor={r.falabellaDesconectadas} />
      </RejillaKpi>

      {visibles.length === 0 ? (
        <EstadoVacio>{todas ? "Todavía no hay empresas." : "Ninguna empresa tiene problemas de conexión. 👍"}</EstadoVacio>
      ) : (
        <Tabla encabezados={["Empresa", "Estado", "ML conectadas", "ML desconectadas", "ML por revisar", "Avisos atrasados", "Publicidad con error", "Falabella desconectadas", ""]}>
          {visibles.map((f) => (
            <FilaTabla key={f.empresaId}>
              <CeldaTabla>{f.nombre}</CeldaTabla>
              <CeldaTabla>{f.estado === "suspendida" ? <Chip estado="advertencia">suspendida</Chip> : f.estado}</CeldaTabla>
              <CeldaTabla>{f.mlConectadas === 0 && f.mlDesconectadas > 0 && f.estado !== "suspendida" ? <Chip estado="peligro">0</Chip> : f.mlConectadas}</CeldaTabla>
              <CeldaTabla>{n(f.mlDesconectadas)}</CeldaTabla>
              <CeldaTabla>{n(f.mlSinRenovar)}</CeldaTabla>
              <CeldaTabla>{n(f.avisosAtrasados)}</CeldaTabla>
              <CeldaTabla>{n(f.publicidadConError)}</CeldaTabla>
              <CeldaTabla>{n(f.falabellaDesconectadas)}</CeldaTabla>
              <CeldaTabla>
                <BotonLink href={`/superadmin/${f.empresaId}`}>Ver</BotonLink>
              </CeldaTabla>
            </FilaTabla>
          ))}
        </Tabla>
      )}
    </>
  );
}
