import { notFound, redirect } from "next/navigation";
import { cookies } from "next/headers";
import { listarEmpresasDeUsuario } from "@/lib/empresas";
import { obtenerMiMembresia } from "@/lib/membresias";
import { obtenerOCrearUsuarioActual } from "@/lib/usuarios";
import { requierePermiso, SinPermisoError } from "@/lib/permisos";
import { obtenerDetalleSeguimiento } from "@/lib/seguimiento/seguimientos";
import { mensajeAlerta, normalizarPublicaciones, obtenerPrecioAproximado, obtenerVendidosAproximado } from "@/lib/seguimiento/alertas";
import {
  calcularComparativaAyerHoy,
  resumenPeriodoConteo,
  resumenPeriodoVentas,
  type ComparativaProducto,
  type LecturaConteo,
  type LecturaProducto,
  type ResumenPeriodoConteo,
  type ResumenPeriodoVentas,
} from "@/lib/seguimiento/estimacionInventario";
import { construirLinkMlDeSeguimiento } from "@/lib/seguimiento/link";
import { EscuchaExtension } from "../EscuchaExtension";
import { BotonLink } from "@/components/marco/Boton";
import { Chip } from "@/components/marco/Chip";
import { CeldaTabla, FilaTabla, Tabla } from "@/components/marco/Tabla";
import { EncabezadoPagina } from "@/components/marco/EncabezadoPagina";
import { EstadoVacio } from "@/components/marco/EstadoVacio";
import { SinAcceso } from "@/components/marco/SinAcceso";
import { Tarjeta } from "@/components/marco/Tarjeta";
import { GraficaLineas } from "@/components/marco/GraficaLineas";
import styles from "./page.module.css";

function dinero(n: number | string | null): string {
  if (n == null) return "—";
  return `$${Number(n).toLocaleString("es-CO")}`;
}

function fecha(d: Date): string {
  return new Date(d).toLocaleDateString("es-CO", { day: "2-digit", month: "2-digit" });
}

// Issue #251, puntos 8/12/13 — "estimado" nunca se muestra sin esta
// etiqueta al lado (misma regla que lib/ml/estimacionVentas.ts para
// no confundirlo con un dato confirmado por Mercado Libre).
function Estimado() {
  return <Chip estado="aviso">Estimado</Chip>;
}

function filaResumenPeriodo(titulo: string, resumen: ResumenPeriodoVentas | ResumenPeriodoConteo | null, unidad: string): React.ReactNode {
  const valor = "ventasEstimadas" in (resumen ?? {}) ? (resumen as ResumenPeriodoVentas).ventasEstimadas : (resumen as ResumenPeriodoConteo | null)?.diferencia;
  return (
    <li className={styles.filaAlerta}>
      <span>
        <strong>{titulo}:</strong>{" "}
        {resumen == null ? (
          "Falta otra lectura para comparar"
        ) : (
          <>
            {valor! >= 0 ? "+" : ""}
            {valor} {unidad} (promedio {resumen.promedioPorDia >= 0 ? "+" : ""}
            {resumen.promedioPorDia}/día — {resumen.diasConLectura} de {resumen.diasPeriodo} días con lectura)
          </>
        )}
      </span>
      {resumen != null ? <Estimado /> : null}
    </li>
  );
}

// Issue #175, punto 5/6 — detalle con historial y gráfica de precio e
// inventario/ventas por día. "Ventas por día" se calcula ACÁ, como la
// diferencia entre el sold_quantity de una foto y el de la anterior
// (misma cuenta que lib/seguimiento/alertas.ts, alertasDeVendidos) —
// nunca el acumulado histórico tal cual, que no serviría de gráfica de
// "por día". El primer punto siempre queda sin dato (no hay foto
// anterior con la que compararlo).
export default async function DetalleSeguimientoPage({ params }: { params: { id: string } }) {
  const usuario = await obtenerOCrearUsuarioActual();
  if (!usuario) redirect("/sign-in");

  const propias = await listarEmpresasDeUsuario(usuario.id);
  const empresaId = cookies().get("empresa_actual")?.value;
  const empresa = propias.find((e) => e.id === empresaId) ?? propias[0];
  if (!empresa) redirect("/crear-empresa");

  try {
    await requierePermiso(usuario.id, empresa.id, "inventario", "consultar");
  } catch (error) {
    if (!(error instanceof SinPermisoError)) throw error;
    const miMembresia = await obtenerMiMembresia(usuario.id, empresa.id);
    return <SinAcceso mensaje={`Tu rol (${miMembresia?.rolNombre ?? "sin rol"}) no tiene acceso a esta pantalla.`} />;
  }

  const detalle = await obtenerDetalleSeguimiento(empresa.id, params.id);
  if (!detalle) notFound();

  const { seguimiento, fotos, alertas } = detalle;

  const puntosPrecio = fotos.map((f) => ({ etiqueta: fecha(f.fecha), valor: f.precio != null ? Number(f.precio) : null }));
  const puntosVentas = fotos.map((f, i) => {
    if (i === 0 || f.vendidos == null || fotos[i - 1].vendidos == null) return { etiqueta: fecha(f.fecha), valor: null };
    const diferencia = f.vendidos - fotos[i - 1].vendidos!;
    return { etiqueta: fecha(f.fecha), valor: diferencia >= 0 ? diferencia : null }; // nunca negativo en la gráfica — sold_quantity nunca debería bajar
  });

  // Issue #251, puntos 8/12/13 — comparativa/estimación de ventas, SOLO
  // para un competidor: un seguimiento propio (esCompetidor=false) ya
  // tiene sold_quantity real de la API, no necesita esta estimación
  // (misma regla que necesitaLecturaDePagina, lib/seguimiento/
  // estimacionInventario.ts).
  const ahora = new Date();
  let comparativaAyerHoy: ComparativaProducto | null = null;
  let resumen7: ResumenPeriodoVentas | ResumenPeriodoConteo | null = null;
  let resumen30: ResumenPeriodoVentas | ResumenPeriodoConteo | null = null;
  if (seguimiento.esCompetidor && seguimiento.tipo === "producto") {
    const lecturas: LecturaProducto[] = fotos.map((f) => ({
      fecha: f.fecha,
      inventario: f.inventarioDisponible,
      aproximado: f.inventarioAproximado,
      // Issue #252 (smoke de staging) — `vendidos` quedó reservado al
      // número EXACTO (corrección de Pablo, punto 5 de la revisión
      // anterior); el piso "+N vendidos" vive aparte, en
      // `publicaciones` (ver obtenerVendidosAproximado). Sin este
      // respaldo, compararProductoDiaADia nunca tenía con qué
      // comparar cuando el inventario no estaba disponible — el
      // respaldo de texto quedaba muerto en la práctica.
      vendidosTexto: f.vendidos ?? obtenerVendidosAproximado(f.publicaciones),
    }));
    // Issue #251 (corrección de Pablo, punto 9) — "Ayer vs hoy" exige
    // una foto fechada EXACTAMENTE hoy y otra EXACTAMENTE ayer (hora
    // Bogotá), con inventario en las dos — nunca "las últimas dos
    // lecturas que hubiera", que podrían ser de hace varios días si el
    // cron se saltó alguno.
    comparativaAyerHoy = calcularComparativaAyerHoy(lecturas, ahora);
    resumen7 = resumenPeriodoVentas(lecturas, 7, ahora);
    resumen30 = resumenPeriodoVentas(lecturas, 30, ahora);
  } else if (seguimiento.esCompetidor && seguimiento.tipo === "tienda") {
    const lecturas: LecturaConteo[] = fotos.map((f) => ({ fecha: f.fecha, valor: normalizarPublicaciones(f.publicaciones)?.total ?? null }));
    resumen7 = resumenPeriodoConteo(lecturas, 7, ahora);
    resumen30 = resumenPeriodoConteo(lecturas, 30, ahora);
  }

  return (
    <>
      {/* Issue #251 (corrección de Pablo, punto 7) — antes solo
      page.tsx (la lista) montaba esto; si la persona abre la ficha de
      un competidor mientras tiene esta pantalla de DETALLE abierta en
      Zilonix (no la lista), nada escuchaba el mensaje y esa lectura se
      perdía. */}
      <EscuchaExtension />
      <EncabezadoPagina
        titulo={seguimiento.nombre}
        descripcion={`${seguimiento.tipo === "tienda" ? "Tienda" : "Producto"} seguido desde ${fecha(seguimiento.creadoTs)}${seguimiento.esCompetidor ? " — marcado como competidor" : ""}.`}
      />

      {/* Issue #195 — nunca seguimiento.linkOriginal: es el texto CRUDO
          que la persona pegó al agregar (puede ser un id suelto sin
          forma de URL, ej. solo "123456789" si agregó por seller_id
          directo) — el link real siempre se arma desde recursoMl +
          mlIdExterno, ya validados. */}
      <p className={styles.link}>
        <a href={construirLinkMlDeSeguimiento(seguimiento.recursoMl, seguimiento.mlIdExterno)} target="_blank" rel="noopener noreferrer">
          Ver en Mercado Libre
        </a>
      </p>

      {fotos.length === 0 ? (
        <EstadoVacio>Todavía no hay ninguna foto — llega con la próxima revisión diaria.</EstadoVacio>
      ) : (
        <>
          <Tarjeta className={styles.seccion}>
            <div className={styles.graficas}>
              <GraficaLineas titulo="Precio" puntos={puntosPrecio} formatoValor={dinero} />
              {seguimiento.tipo === "producto" ? <GraficaLineas titulo="Ventas por día (sold_quantity real de Mercado Libre)" puntos={puntosVentas} /> : null}
            </div>
          </Tarjeta>

          <Tarjeta className={styles.seccion}>
            <p className={styles.tituloSeccion}>Historial ({fotos.length} día{fotos.length === 1 ? "" : "s"})</p>
            <Tabla encabezados={["Fecha", "Precio", "Inventario", "Vendidos", "Estado", "Catálogo", "Gana botón"]}>
              {[...fotos].reverse().map((f) => (
                <FilaTabla key={f.id}>
                  <CeldaTabla>{fecha(f.fecha)}</CeldaTabla>
                  <CeldaTabla>
                    {/* Issue #252 (smoke de staging, punto 3) — mismo
                    respaldo que vendidos: si la API nunca confirmó el
                    precio pero la extensión ya lo leyó de la página,
                    se muestra ese valor como aproximado en vez de "—". */}
                    {f.precio != null ? dinero(f.precio) : obtenerPrecioAproximado(f.publicaciones) != null ? `${dinero(obtenerPrecioAproximado(f.publicaciones))} (aproximado)` : "—"}
                  </CeldaTabla>
                  <CeldaTabla>
                    {f.inventarioDisponible ?? "—"}
                    {f.inventarioAproximado ? <Chip>Aprox.</Chip> : null}
                  </CeldaTabla>
                  <CeldaTabla>
                    {/* Issue #252 (smoke de staging) — mismo criterio
                    que la lista (page.tsx): el piso "+N vendidos"
                    (nunca comparado en alertas) se muestra cuando no
                    hay un número exacto todavía. */}
                    {f.vendidos ?? (obtenerVendidosAproximado(f.publicaciones) != null ? `+${obtenerVendidosAproximado(f.publicaciones)} (aproximado)` : "—")}
                  </CeldaTabla>
                  <CeldaTabla>{f.estado ?? "—"}</CeldaTabla>
                  <CeldaTabla>{f.enCatalogo == null ? "—" : f.enCatalogo ? "Sí" : "No"}</CeldaTabla>
                  <CeldaTabla>{f.ganaBotonCompra == null ? "—" : f.ganaBotonCompra ? "Gana" : "Pierde"}</CeldaTabla>
                </FilaTabla>
              ))}
            </Tabla>
          </Tarjeta>
        </>
      )}

      {seguimiento.esCompetidor && (comparativaAyerHoy || resumen7 || resumen30) ? (
        <Tarjeta className={styles.seccion}>
          <p className={styles.tituloSeccion}>Ventas estimadas (issue #251 — nunca sold_quantity real de un competidor, Mercado Libre no lo deja ver por la API)</p>
          <ul className={styles.listaAlertas}>
            {seguimiento.tipo === "producto" ? (
              <li className={styles.filaAlerta}>
                <span>
                  <strong>Ayer a hoy:</strong>{" "}
                  {comparativaAyerHoy == null ? (
                    // Issue #251 (corrección de Pablo, punto 9) —
                    // mensaje DISTINTO de "Falta otra lectura para
                    // comparar": acá específicamente falta la foto de
                    // HOY o de AYER (Bogotá) con inventario, no otra
                    // lectura cualquiera.
                    "Falta lectura de hoy o de ayer"
                  ) : comparativaAyerHoy.reposicion ? (
                    "reposición de stock detectada (inventario subió, no se cuenta como venta)"
                  ) : comparativaAyerHoy.ventasEstimadas == null ? (
                    "Falta otra lectura para comparar"
                  ) : (
                    `${comparativaAyerHoy.ventasEstimadas} unidades (${fecha(comparativaAyerHoy.fechaAnterior)} → ${fecha(comparativaAyerHoy.fechaActual)})`
                  )}
                </span>
                {comparativaAyerHoy != null ? <Estimado /> : null}
              </li>
            ) : null}
            {filaResumenPeriodo("Últimos 7 días", resumen7, seguimiento.tipo === "producto" ? "unidades" : "publicaciones")}
            {filaResumenPeriodo("Últimos 30 días", resumen30, seguimiento.tipo === "producto" ? "unidades" : "publicaciones")}
          </ul>
        </Tarjeta>
      ) : null}

      <Tarjeta className={styles.seccion}>
        <p className={styles.tituloSeccion}>Alertas</p>
        {alertas.length === 0 ? (
          <EstadoVacio>Todavía no se generó ninguna alerta para este seguimiento.</EstadoVacio>
        ) : (
          <ul className={styles.listaAlertas}>
            {alertas.map((alerta) => (
              <li key={alerta.id} className={styles.filaAlerta}>
                <span>{mensajeAlerta({ tipo: alerta.tipo, detalle: alerta.detalle as Record<string, unknown> })}</span>
                <span className={styles.fechaAlerta}>
                  {new Date(alerta.creadoTs).toLocaleDateString("es-CO")} {alerta.leidaTs ? <Chip>Leída</Chip> : null}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Tarjeta>

      <BotonLink href="/panel/investigacion/seguimiento" variante="fantasma" chico className={styles.volver}>
        Volver al seguimiento
      </BotonLink>
    </>
  );
}
