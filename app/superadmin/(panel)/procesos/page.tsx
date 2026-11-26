import { avisosEnCola, listarEstadoProcesos, requiereSesionSuperadmin } from "@/lib/superadmin";
import { ETIQUETA_SEMAFORO, INFO_PROCESOS, etiquetaResumen, haceCuanto, semaforoDe, type Semaforo } from "@/lib/superadmin-procesos";
import { EncabezadoPagina } from "@/components/marco/EncabezadoPagina";
import { RejillaKpi } from "@/components/marco/RejillaKpi";
import { TarjetaKpi } from "@/components/marco/TarjetaKpi";
import { Tabla, FilaTabla, CeldaTabla } from "@/components/marco/Tabla";
import { Chip, type EstadoChip } from "@/components/marco/Chip";

// Estado de los procesos (25-nov): si los procesos automáticos (avisos de
// ML, publicidad, seguimiento) siguen corriendo, sin entrar a los logs de
// Railway. Solo conteos de la plataforma, nada de una empresa (D8).
const COLOR: Record<Semaforo, EstadoChip> = { al_dia: "exito", atrasado: "peligro", fallo: "peligro", sin_datos: "neutro" };
const hora = (d: Date) => d.toLocaleString("es-CO", { timeZone: "America/Bogota" });

export default async function SuperadminProcesosPage() {
  await requiereSesionSuperadmin();
  const [procesos, cola] = await Promise.all([listarEstadoProcesos(), avisosEnCola()]);
  const ahora = new Date();
  const conProblema = procesos.filter((p) => ["atrasado", "fallo"].includes(semaforoDe(p, ahora))).length;

  return (
    <>
      <EncabezadoPagina
        titulo="Procesos"
        descripcion="Si los procesos automáticos de la plataforma siguen corriendo. «Atrasado»: lleva más tiempo del normal sin correr. «Falló»: la última corrida terminó con error. Horas de Colombia."
      />
      <RejillaKpi>
        <TarjetaKpi titulo="Procesos con problema" valor={conProblema} />
        <TarjetaKpi titulo="Avisos en cola" valor={cola.pendientes} />
        <TarjetaKpi titulo="Avisos atrasados (más de 1 h)" valor={cola.atrasados} />
      </RejillaKpi>

      <Tabla encabezados={["Proceso", "Estado", "Última corrida", "Última sin error", "Corridas 24 h", "Con error 24 h", "Resultado de la última"]}>
        {procesos.map((p) => {
          const info = INFO_PROCESOS[p.proceso];
          const semaforo = semaforoDe(p, ahora);
          const resumen = Object.entries(p.ultimoResumen).filter(([, v]) => v !== 0);
          return (
            <FilaTabla key={p.proceso}>
              <CeldaTabla>
                <strong>{info.nombre}</strong>
                <br />
                <small>
                  {info.queHace} Corre {info.cadaCuanto}.
                </small>
              </CeldaTabla>
              <CeldaTabla>
                <Chip estado={COLOR[semaforo]}>{ETIQUETA_SEMAFORO[semaforo]}</Chip>
              </CeldaTabla>
              <CeldaTabla>
                {p.ultimaTs ? (
                  <span title={hora(p.ultimaTs)}>{haceCuanto(p.ultimaTs, ahora)}</span>
                ) : (
                  "Nunca"
                )}
              </CeldaTabla>
              <CeldaTabla>{p.ultimaExitosaTs ? <span title={hora(p.ultimaExitosaTs)}>{haceCuanto(p.ultimaExitosaTs, ahora)}</span> : "Nunca"}</CeldaTabla>
              <CeldaTabla numerica>{p.corridas24h}</CeldaTabla>
              <CeldaTabla numerica>{p.fallidas24h > 0 ? <Chip estado="peligro">{p.fallidas24h}</Chip> : 0}</CeldaTabla>
              <CeldaTabla>
                {p.ultimaOk === false && p.ultimoError ? (
                  <small>{p.ultimoError}</small>
                ) : resumen.length === 0 ? (
                  p.ultimaTs ? "Sin trabajo pendiente" : "—"
                ) : (
                  <small>{resumen.map(([k, v]) => `${etiquetaResumen(k)}: ${v}`).join(" · ")}</small>
                )}
              </CeldaTabla>
            </FilaTabla>
          );
        })}
      </Tabla>
    </>
  );
}
