import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { listarEmpresasDeUsuario } from "@/lib/empresas";
import { obtenerMiMembresia } from "@/lib/membresias";
import { obtenerOCrearUsuarioActual } from "@/lib/usuarios";
import { requierePermiso, SinPermisoError } from "@/lib/permisos";
import { normalizarParametro, normalizarTextoBusqueda } from "@/lib/filtros-listado";
import { LimiteMercadoLibreError, MlNoAutorizadoError, MlNoDisponibleError, MlRespuestaInesperadaError, MlSinPermisoAppError } from "@/lib/ml/cliente";
import { CandadoDeRenovacionError, CuentaDesconectadaError, CuentaMlNoEncontradaError, RenovacionTokenFallidaError } from "@/lib/ml/cuentas";
import {
  buscarInvestigacionProducto,
  LimiteBusquedasError,
  SinCuentaMlError,
  TerminoInvalidoError,
  type ResultadoInvestigacion,
} from "@/lib/ml/investigacion";
import { Boton, BotonLink } from "@/components/marco/Boton";
import { Campo } from "@/components/marco/Campo";
import { Chip } from "@/components/marco/Chip";
import { CeldaTabla, FilaTabla, Tabla } from "@/components/marco/Tabla";
import { EncabezadoPagina } from "@/components/marco/EncabezadoPagina";
import { EstadoVacio } from "@/components/marco/EstadoVacio";
import { SinAcceso } from "@/components/marco/SinAcceso";
import { Tarjeta } from "@/components/marco/Tarjeta";
import { TarjetaKpi } from "@/components/marco/TarjetaKpi";
import styles from "./page.module.css";

// Nueva tarea: módulo "Investigación" de Zilonix OS, PARTE 1 (solo
// Mercado Libre Colombia) — buscador de producto/nicho (1-3 palabras)
// con datos reales de la API oficial de Mercado Libre, antes de
// invertir en él. Todo el cálculo real vive en lib/ml/investigacion.ts;
// esta página solo lee el término de la URL (?termino=, mismo patrón
// que ?q= en /panel/pedidos) y pinta el resultado o el aviso.
//
// Amazon, Temu, AliExpress, Shein, Alibaba y la extensión de Chrome
// (que en Zilonix OS es como se consigue "vendidos" real — ver el
// comentario de ordenPublicaciones en lib/ml/investigacion.ts) quedan
// pendientes a propósito, documentados en
// docs/changelog/pendientes/feat-investigacion-ml.md — no se
// construyen en esta Parte 1.

function money(n: number): string {
  return `$${n.toLocaleString("es-CO")}`;
}

export default async function InvestigacionPage({ searchParams }: { searchParams: { termino?: string | string[] } }) {
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

  const terminoUrl = normalizarParametro(searchParams.termino);
  const termino = normalizarTextoBusqueda(terminoUrl) ?? "";

  let resultado: ResultadoInvestigacion | null = null;
  let errorBusqueda: string | null = null;
  // Issue #147 — bug real: cualquier error que no fuera uno de los 4
  // tipos de arriba (ej. un 401/403 real de Mercado Libre, la cuenta
  // desconectada, el candado de renovación, invalid_grant) se
  // relanzaba tal cual y, sin app/panel/investigacion/error.tsx,
  // Next.js mostraba "Application error" sin mensaje — justo lo que
  // reportó Mateo. Ahora se atrapan todos los tipos conocidos con un
  // mensaje en español claro; lo único que de verdad sigue subiendo
  // (a error.tsx) es un error que de verdad no se esperaba.
  let mostrarEnlaceReconectar = false;

  if (termino) {
    try {
      resultado = await buscarInvestigacionProducto(empresa.id, termino);
    } catch (error) {
      if (
        error instanceof TerminoInvalidoError ||
        error instanceof LimiteBusquedasError ||
        error instanceof SinCuentaMlError ||
        error instanceof LimiteMercadoLibreError ||
        error instanceof MlSinPermisoAppError ||
        error instanceof MlNoDisponibleError ||
        error instanceof MlRespuestaInesperadaError
      ) {
        errorBusqueda = error.message;
      } else if (error instanceof MlNoAutorizadoError || error instanceof CuentaDesconectadaError || error instanceof RenovacionTokenFallidaError) {
        errorBusqueda = error.message;
        mostrarEnlaceReconectar = true;
      } else if (error instanceof CuentaMlNoEncontradaError) {
        errorBusqueda = error.message;
      } else if (error instanceof CandadoDeRenovacionError) {
        errorBusqueda = error.message; // el mensaje ya incluye "reintentar en unos segundos" — no se duplica
      } else {
        throw error;
      }
    }
  }

  return (
    <>
      <EncabezadoPagina
        titulo="Investigación"
        descripcion="Analiza un producto o nicho con datos reales de Mercado Libre Colombia antes de invertir en él."
      />

      <Tarjeta className={styles.formulario}>
        <form method="get" className={styles.filaFormulario}>
          <Campo etiqueta="Producto o nicho (hasta 3 palabras)">
            <input
              type="search"
              name="termino"
              defaultValue={termino}
              placeholder='Ej: "reloj digital"'
              className="zx-control"
              required
            />
          </Campo>
          <Boton type="submit">Analizar</Boton>
        </form>
        <p className={styles.ayuda}>
          Solo Mercado Libre Colombia por ahora — Amazon, Temu, AliExpress, Shein y Alibaba quedan pendientes.
        </p>
      </Tarjeta>

      {errorBusqueda ? (
        <EstadoVacio>
          {errorBusqueda}
          {mostrarEnlaceReconectar ? (
            <>
              {" "}
              <BotonLink href="/panel/conectar-ml" variante="secundario" chico>
                Reconectar cuenta
              </BotonLink>
            </>
          ) : null}
        </EstadoVacio>
      ) : null}

      {!termino && !errorBusqueda ? (
        <EstadoVacio>Escribe un producto o nicho para analizar demanda, competencia y oportunidades.</EstadoVacio>
      ) : null}

      {resultado && resultado.aviso ? <EstadoVacio>{resultado.aviso}</EstadoVacio> : null}

      {resultado && !resultado.aviso ? (
        <div className={styles.resultado}>
          <p className={styles.alcance}>
            Publicaciones de catálogo con oferta activa encontradas para &quot;{resultado.termino}&quot; — no es el total de
            publicaciones del mercado (esa cifra no la expone la API oficial de Mercado Libre a esta aplicación).
          </p>

          <div className={styles.kpis}>
            <TarjetaKpi titulo="PUBLICACIONES ENCONTRADAS" valor={resultado.publicacionesEncontradas} />
            <TarjetaKpi titulo="VENDEDORES DISTINTOS" valor={resultado.vendedoresDistintos} />
            <TarjetaKpi titulo="PRECIO MÍNIMO" valor={resultado.precioMinimo != null ? money(resultado.precioMinimo) : undefined} />
            <TarjetaKpi titulo="PRECIO PROMEDIO (TICKET)" valor={resultado.precioPromedio != null ? money(resultado.precioPromedio) : undefined} />
            <TarjetaKpi titulo="PRECIO MÁXIMO" valor={resultado.precioMaximo != null ? money(resultado.precioMaximo) : undefined} />
            <TarjetaKpi titulo="% FULL" valor={resultado.porcentajeFull != null ? `${resultado.porcentajeFull}%` : undefined} />
            <TarjetaKpi titulo="% ENVÍO GRATIS" valor={resultado.porcentajeEnvioGratis != null ? `${resultado.porcentajeEnvioGratis}%` : undefined} />
          </div>

          <Tarjeta>
            <p className={styles.tituloSeccion}>Estrategia sugerida</p>
            {resultado.estrategiaSugerida.length ? (
              <ul className={styles.listaEstrategia}>
                {resultado.estrategiaSugerida.map((regla, i) => (
                  <li key={i}>{regla.texto}</li>
                ))}
              </ul>
            ) : (
              <EstadoVacio>No hay suficientes datos reales todavía para sugerir una estrategia.</EstadoVacio>
            )}
          </Tarjeta>

          <div>
            <p className={styles.tituloSeccion}>
              Publicaciones encontradas (hasta 10 — sin &quot;vendidos&quot;: la API oficial no lo expone para publicaciones
              ajenas, ver el aviso de la tarea)
            </p>
            <Tabla encabezados={["Producto", "Precio", "Full", "Vendedor", "Enlace"]}>
              {resultado.publicaciones.map((p) => (
                <FilaTabla key={p.itemId}>
                  <CeldaTabla>{p.titulo}</CeldaTabla>
                  <CeldaTabla>{money(p.precio)}</CeldaTabla>
                  <CeldaTabla>{p.esFull ? <Chip estado="exito">Full</Chip> : <Chip>—</Chip>}</CeldaTabla>
                  <CeldaTabla>{p.vendedor ?? "—"}</CeldaTabla>
                  <CeldaTabla>
                    {p.link ? (
                      <a href={p.link} target="_blank" rel="noreferrer">
                        Ver en Mercado Libre
                      </a>
                    ) : (
                      "—"
                    )}
                  </CeldaTabla>
                </FilaTabla>
              ))}
            </Tabla>
          </div>
        </div>
      ) : null}

      <BotonLink href="/panel" variante="fantasma" chico className={styles.volver}>
        Volver al panel
      </BotonLink>
    </>
  );
}
