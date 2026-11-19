import Link from "next/link";
import { obtenerContextoPanel } from "@/lib/panel-contexto";
import { requierePermiso, SinPermisoError } from "@/lib/permisos";
import { listarCortesFalabella, SIN_CORTE } from "@/lib/falabella/conciliacion";
import { mostrarMontoIso } from "@/components/finanzas/formato";
import { BotonLink } from "@/components/marco/Boton";
import { ChipsEstadoPago } from "@/components/finanzas/ChipEstadoPago";
import { EncabezadoPagina } from "@/components/marco/EncabezadoPagina";
import { EstadoVacio } from "@/components/marco/EstadoVacio";
import { SinAcceso } from "@/components/marco/SinAcceso";
import { CeldaTabla, FilaTabla, Tabla } from "@/components/marco/Tabla";
import { Tarjeta } from "@/components/marco/Tarjeta";
import styles from "../finanzas.module.css";

// Issue #422 — conciliación de pagos de Falabella: lista de cortes
// (Nº de estado de cuenta) armada con los reportes de transacciones que
// se cargaron. Solo lectura: finanzas.consultar (acá y en
// lib/falabella/conciliacion.ts).

function rango(desde: string | null, hasta: string | null): string {
  if (!desde || !hasta) return "—";
  return desde === hasta ? desde : `${desde} a ${hasta}`;
}

export default async function ConciliacionFalabellaPage() {
  const { usuario, activa: empresa, rolNombre } = await obtenerContextoPanel();
  let cortes;
  try {
    await requierePermiso(usuario.id, empresa.id, "finanzas", "consultar");
    cortes = await listarCortesFalabella(empresa.id, usuario.id);
  } catch (error) {
    if (!(error instanceof SinPermisoError)) throw error;
    return <SinAcceso mensaje={`Tu rol (${rolNombre}) no tiene acceso a Finanzas.`} />;
  }
  const puedeCargar = await requierePermiso(usuario.id, empresa.id, "finanzas", "modificar").then(
    () => true,
    (error) => {
      if (error instanceof SinPermisoError) return false;
      throw error;
    }
  );

  return (
    <>
      <EncabezadoPagina
        titulo="Conciliación Falabella"
        descripcion="Cada corte de pago de Falabella con lo que vendiste, lo que cobró Falabella y lo que te pagó."
        accion={
          puedeCargar ? (
            <BotonLink href="/panel/finanzas/falabella/importar" chico>
              Cargar reporte
            </BotonLink>
          ) : undefined
        }
      />
      <Tarjeta>
        <h2 className={styles.tituloSeccion}>Cortes</h2>
        {cortes.length === 0 ? (
          <EstadoVacio>
            Todavía no hay reportes cargados. Descarga el «Reporte de transacciones» en Falabella Seller Center → Pagos → Estado de cuenta y cárgalo
            acá.
          </EstadoVacio>
        ) : (
          <Tabla
            encabezados={[
              "Estado de cuenta",
              "Cuenta",
              "Fechas",
              "Estado de pago",
              "Órdenes",
              { clave: "total", contenido: "Total", numerica: true },
            ]}
          >
            {cortes.map((c) => {
              const params = new URLSearchParams({ cuenta: c.cuentaId, corte: c.estadoCuenta ?? SIN_CORTE, moneda: c.moneda });
              return (
                <FilaTabla key={`${c.cuentaId}-${c.estadoCuenta ?? SIN_CORTE}-${c.moneda}`}>
                  <CeldaTabla>
                    <Link href={`/panel/finanzas/falabella/corte?${params.toString()}`} className={styles.enlace}>
                      {c.estadoCuenta ?? "Sin estado de cuenta todavía"}
                    </Link>
                  </CeldaTabla>
                  <CeldaTabla>{c.cuenta}</CeldaTabla>
                  <CeldaTabla>{rango(c.desde, c.hasta)}</CeldaTabla>
                  <CeldaTabla>
                    <ChipsEstadoPago estados={c.estadosPago} />
                  </CeldaTabla>
                  <CeldaTabla>{c.ordenes}</CeldaTabla>
                  <CeldaTabla numerica>{mostrarMontoIso(c.total, c.moneda)}</CeldaTabla>
                </FilaTabla>
              );
            })}
          </Tabla>
        )}
      </Tarjeta>
      <BotonLink href="/panel/finanzas" variante="fantasma" chico className={styles.volver}>
        Volver a Finanzas
      </BotonLink>
    </>
  );
}
