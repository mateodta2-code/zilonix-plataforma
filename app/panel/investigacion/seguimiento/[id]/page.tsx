import { notFound, redirect } from "next/navigation";
import { cookies } from "next/headers";
import { listarEmpresasDeUsuario } from "@/lib/empresas";
import { obtenerMiMembresia } from "@/lib/membresias";
import { obtenerOCrearUsuarioActual } from "@/lib/usuarios";
import { requierePermiso, SinPermisoError } from "@/lib/permisos";
import { obtenerDetalleSeguimiento } from "@/lib/seguimiento/seguimientos";
import { mensajeAlerta } from "@/lib/seguimiento/alertas";
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

  return (
    <>
      <EncabezadoPagina
        titulo={seguimiento.nombre}
        descripcion={`${seguimiento.tipo === "tienda" ? "Tienda" : "Producto"} seguido desde ${fecha(seguimiento.creadoTs)}${seguimiento.esCompetidor ? " — marcado como competidor" : ""}.`}
      />

      <p className={styles.link}>
        <a href={seguimiento.linkOriginal} target="_blank" rel="noreferrer">
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
                  <CeldaTabla>{dinero(f.precio)}</CeldaTabla>
                  <CeldaTabla>
                    {f.inventarioDisponible ?? "—"}
                    {f.inventarioAproximado ? <Chip>Aprox.</Chip> : null}
                  </CeldaTabla>
                  <CeldaTabla>{f.vendidos ?? "—"}</CeldaTabla>
                  <CeldaTabla>{f.estado ?? "—"}</CeldaTabla>
                  <CeldaTabla>{f.enCatalogo == null ? "—" : f.enCatalogo ? "Sí" : "No"}</CeldaTabla>
                  <CeldaTabla>{f.ganaBotonCompra == null ? "—" : f.ganaBotonCompra ? "Gana" : "Pierde"}</CeldaTabla>
                </FilaTabla>
              ))}
            </Tabla>
          </Tarjeta>
        </>
      )}

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
