import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { listarEmpresasDeUsuario } from "@/lib/empresas";
import { obtenerMiMembresia } from "@/lib/membresias";
import { obtenerOCrearUsuarioActual } from "@/lib/usuarios";
import { requierePermiso, SinPermisoError } from "@/lib/permisos";
import { formatearMonto } from "@/lib/panel-kpis";
import { leerTableroMes, textoVariacion, type TableroMes } from "@/lib/finanzas/tablero";
import { BotonLink } from "@/components/marco/Boton";
import { EncabezadoPagina } from "@/components/marco/EncabezadoPagina";
import { SinAcceso } from "@/components/marco/SinAcceso";
import { TarjetaKpi } from "@/components/marco/TarjetaKpi";
import styles from "./finanzas.module.css";

// Tarea 1.7/1.8 — nació como pantalla de demostración para el criterio
// de "listo" de la 1.7 ("el operador no ve Finanzas"), con la función
// única de la 1.8 (requierePermiso) en vez del candado a mano que tenía
// antes. El candado sigue igual: sin finanzas.consultar, SinAcceso.
//
// Issue #124 (Z-FIN-02) — "ver" y "editar" van separados: esta
// pantalla solo lee, así que exige "consultar" y nada más. Cuando
// llegue la primera acción que cambie algo de finanzas (Fase 3), su
// actions.ts tiene que pedir "crear" o "modificar" con requierePermiso
// en el servidor — el Auxiliar y el Contador pueden ver Y editar, pero
// un rol con solo "consultar" nunca debe poder guardar nada, aunque
// arme el formulario a mano.
//
// Issue #163 (parte de #143) — la demo se reemplaza por las tres
// primeras tarjetas reales del tablero: ventas, recaudo y recaudo
// promedio diario del mes, contra el mismo tramo del mes anterior
// (lib/finanzas/tablero.ts). Solo la empresa de la sesión, todas sus
// cuentas de Mercado Libre.

// "COP 1.234.000 · USD 50"; sin ventas, "COP 0" (mismo criterio que
// Ventas del mes de /panel).
function porMoneda(tablero: TableroMes, campo: "actual" | "promedioActual"): string {
  if (tablero.recaudo.length === 0) return "COP 0";
  return tablero.recaudo.map((r) => `${r.moneda} ${formatearMonto(r[campo])}`).join(" · ");
}

// Una línea de variación por moneda (con el código solo si hay varias).
function variacionesPorMoneda(tablero: TableroMes, campo: "variacion" | "variacionPromedio"): string[] {
  const sinSincronizarAntes = tablero.sinSincronizar.anterior > 0;
  if (tablero.recaudo.length === 0) return [textoVariacion(null, sinSincronizarAntes)];
  const varias = tablero.recaudo.length > 1;
  return tablero.recaudo.map((r) => `${varias ? `${r.moneda}: ` : ""}${textoVariacion(r[campo], sinSincronizarAntes)}`);
}

export default async function FinanzasPage() {
  const usuario = await obtenerOCrearUsuarioActual();
  if (!usuario) redirect("/sign-in");

  const propias = await listarEmpresasDeUsuario(usuario.id);
  const empresaId = cookies().get("empresa_actual")?.value;
  const empresa = propias.find((e) => e.id === empresaId) ?? propias[0];
  if (!empresa) redirect("/crear-empresa");

  try {
    await requierePermiso(usuario.id, empresa.id, "finanzas", "consultar");
    const tablero = await leerTableroMes(empresa.id, usuario.id, new Date());
    const faltan = tablero.sinSincronizar.actual;
    const avisoFaltan = faltan > 0 ? [`Faltan ${faltan} ${faltan === 1 ? "venta" : "ventas"} por sincronizar · usa “Traer ventas de este mes” en Finanzas → Ventas`] : [];
    return (
      <>
        <EncabezadoPagina titulo="Finanzas" />
        <section className={styles.tablero}>
          <h2 className={styles.tituloSeccion}>
            Indicadores del mes ({tablero.tramo.desde} a {tablero.tramo.hasta}) · vs. mismo tramo mes anterior ({tablero.tramoAnterior.desde} a{" "}
            {tablero.tramoAnterior.hasta})
          </h2>
          <p className={styles.ayuda}>
            Todas las cuentas de Mercado Libre de esta empresa · sin ventas canceladas ni inválidas · el recaudo es el de las ventas sincronizadas,
            igual que en Ventas y utilidad.
          </p>
          <div className={styles.gridKpi}>
            <TarjetaKpi
              titulo="Ventas del mes"
              valor={String(tablero.ventas.actual)}
              detalle={[textoVariacion(tablero.ventas.variacion), "Cantidad de ventas del mes (día de creación en Mercado Libre)."]}
            />
            <TarjetaKpi
              titulo="Recaudo del mes"
              valor={porMoneda(tablero, "actual")}
              detalle={[
                ...variacionesPorMoneda(tablero, "variacion"),
                "Suma de lo que pagó el cliente (valor de venta), sin restar comisión, envío ni costos.",
                ...avisoFaltan,
              ]}
            />
            <TarjetaKpi
              titulo="Recaudo promedio diario"
              valor={porMoneda(tablero, "promedioActual")}
              detalle={[
                ...variacionesPorMoneda(tablero, "variacionPromedio"),
                `Recaudo del mes ÷ ${tablero.tramo.dias} ${tablero.tramo.dias === 1 ? "día" : "días"} (hasta hoy, día de Bogotá).`,
                ...avisoFaltan,
              ]}
            />
          </div>
          {faltan > 0 && (
            <p className={styles.ayuda}>
              <BotonLink href="/panel/finanzas/ventas" variante="secundario" chico>
                Ir a Finanzas → Ventas para traer las ventas
              </BotonLink>
            </p>
          )}
        </section>
        {/* Issue #128 — primeras pantallas reales de la Fase 1. Issue #131
            (Parte A) — ventas y utilidad, solo lectura. */}
        <BotonLink href="/panel/finanzas/ventas" variante="secundario" chico>
          Ventas y utilidad
        </BotonLink>{" "}
        <BotonLink href="/panel/finanzas/maestra-sku" variante="secundario" chico>
          Tabla maestra de SKU
        </BotonLink>{" "}
        <BotonLink href="/panel/finanzas/proveedores" variante="secundario" chico>
          Proveedores y transportadores
        </BotonLink>{" "}
        <BotonLink href="/panel" variante="fantasma" chico>
          Volver al panel
        </BotonLink>
      </>
    );
  } catch (error) {
    if (!(error instanceof SinPermisoError)) throw error;
    const miMembresia = await obtenerMiMembresia(usuario.id, empresa.id);
    return (
      <>
        <EncabezadoPagina titulo="Finanzas" />
        <SinAcceso mensaje={`Tu rol (${miMembresia?.rolNombre ?? "sin rol"}) no tiene acceso a este módulo.`} />
      </>
    );
  }
}
