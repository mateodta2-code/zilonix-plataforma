import Link from "next/link";
import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { Boton } from "@/components/marco/Boton";
import { EncabezadoPagina } from "@/components/marco/EncabezadoPagina";
import { EstadoVacio } from "@/components/marco/EstadoVacio";
import { Pestanas } from "@/components/marco/Pestanas";
import { SinAcceso } from "@/components/marco/SinAcceso";
import { Tarjeta } from "@/components/marco/Tarjeta";
import { SelectorCuentaMl } from "@/components/SelectorCuentaMl";
import { opcionesFiltroAuditoria } from "@/lib/auditoria";
import { listarEmpresasDeUsuario } from "@/lib/empresas";
import { obtenerMiMembresia } from "@/lib/membresias";
import { listarCuentasConectadas } from "@/lib/ml/cuentas";
import { leerCuentaMlDeQuery } from "@/lib/ml/selector-cuenta";
import { formatearMoneda } from "@/lib/ml/sitios";
import { DIAS_MAXIMOS_BITACORA, ESTADOS_BITACORA, leerCambiosGenerales, leerFotosCompactas, type CambioGeneral, type EstadoBitacora } from "@/lib/optimizacion/bitacora";
import { ACCIONES_BITACORA, DIAS_MEDICION, MARCA_FOTO_IA_ROTULO } from "@/lib/optimizacion/bitacoraResultado";
import { requierePermiso, SinPermisoError } from "@/lib/permisos";
import { hoyBogota, restarDiasIso } from "@/lib/publicidad/plan";
import { obtenerOCrearUsuarioActual } from "@/lib/usuarios";
import { TablaBitacoraGeneral, type FilaBitacoraVista } from "./TablaBitacoraGeneral";
import styles from "./bitacora.module.css";

// Refs #681 — bitácora general de Optimización: todos los cambios hechos
// desde el módulo, con filtros. No llama a Mercado Libre: el resultado al
// día 8 se calcula solo al pulsar «Ver resultado» en una fila.

type ParametroUrl = string | string[] | undefined;
const primero = (v: ParametroUrl): string | undefined => (typeof v === "string" ? v : Array.isArray(v) ? v.find((x) => typeof x === "string") : undefined);
const DIA = /^\d{4}-\d{2}-\d{2}$/;
const ROTULO_ESTADO: Record<EstadoBitacora, string> = { midiendo: "Midiendo", listo: "Listo para revisar", revisado: "Revisado", sin_revisar: "Sin revisar" };

function textoCambio(c: CambioGeneral, siteId: string | null): string {
  if (c.accion === "cambiar_fotos_publicacion") {
    const antes = leerFotosCompactas(c.valorAnterior);
    const despues = leerFotosCompactas(c.valorNuevo);
    if (antes.length || despues.length) return `${antes.length} → ${despues.length} fotos. ${c.detalle.split("): ").pop() ?? ""}`.trim();
    return c.detalle;
  }
  if (c.valorAnterior === null && c.valorNuevo === null) return c.detalle;
  const valor = (v: string | null) => (v === null ? "—" : c.accion === "cambiar_precio_publicacion" && siteId && Number.isFinite(Number(v)) ? formatearMoneda(Number(v), siteId) : v.length > 60 ? `${v.slice(0, 57)}…` : v);
  return `${valor(c.valorAnterior)} → ${valor(c.valorNuevo)}`;
}

export default async function BitacoraGeneralPage({ searchParams }: { searchParams?: Record<string, ParametroUrl> }) {
  const usuario = await obtenerOCrearUsuarioActual();
  if (!usuario) redirect("/sign-in");
  const propias = await listarEmpresasDeUsuario(usuario.id);
  const empresa = propias.find((e) => e.id === cookies().get("empresa_actual")?.value) ?? propias[0];
  if (!empresa) redirect("/crear-empresa");
  try {
    await requierePermiso(usuario.id, empresa.id, "inventario", "consultar");
  } catch (error) {
    if (!(error instanceof SinPermisoError)) throw error;
    const m = await obtenerMiMembresia(usuario.id, empresa.id);
    return (
      <>
        <EncabezadoPagina titulo="Optimización" />
        <SinAcceso mensaje={`Tu rol (${m?.rolNombre ?? "sin rol"}) no tiene acceso a este módulo.`} />
      </>
    );
  }

  const cuentaParam = primero(searchParams?.cuenta);
  const { cuentaId } = await leerCuentaMlDeQuery(empresa.id, cuentaParam);
  const accion = primero(searchParams?.accion);
  const quien = primero(searchParams?.quien);
  const desde = primero(searchParams?.desde);
  const hasta = primero(searchParams?.hasta);
  const estadoParam = primero(searchParams?.estado);
  const estado = ESTADOS_BITACORA.find((e) => e === estadoParam);
  const q = (primero(searchParams?.q) ?? "").trim().slice(0, 40);
  const pagina = Number.parseInt(primero(searchParams?.pagina) ?? "1", 10) || 1;
  const hoy = hoyBogota(new Date());

  const [{ actores }, cuentas, resultado] = await Promise.all([
    opcionesFiltroAuditoria(empresa.id),
    listarCuentasConectadas(empresa.id),
    leerCambiosGenerales(empresa.id, {
      cuentaMlId: cuentaId ?? undefined,
      accion: accion && accion in ACCIONES_BITACORA ? accion : undefined,
      // leerCambiosGenerales solo acepta un uuid y lo filtra como parámetro.
      usuarioId: quien,
      desde: desde && DIA.test(desde) ? desde : undefined,
      hasta: hasta && DIA.test(hasta) ? hasta : undefined,
      estado,
      itemId: q || undefined,
      pagina,
    }),
  ]);

  const porCuenta = new Map(cuentas.map((c) => [c.id, c]));
  const filas: FilaBitacoraVista[] = resultado.filas.map((c) => {
    const cuenta = c.cuentaMlId ? porCuenta.get(c.cuentaMlId) : undefined;
    const conIA = c.accion === "cambiar_fotos_publicacion" && c.detalle.includes(MARCA_FOTO_IA_ROTULO);
    return {
      ref: c.ref,
      itemId: c.itemId,
      cuentaMlId: c.cuentaMlId,
      cuenta: cuenta?.nickname ?? c.cuentaNickname ?? "—",
      fecha: c.ts.toLocaleDateString(cuenta?.idioma ?? "es", { day: "numeric", month: "short", year: "numeric", timeZone: "America/Bogota" }),
      rotulo: conIA ? "Fotos (con IA)" : c.rotulo,
      queCambio: textoCambio(c, cuenta?.siteId ?? null),
      usuario: c.usuario ?? "—",
      estado: c.estado,
      faltanDias: Math.max(1, Math.round((Date.parse(`${restarDiasIso(c.dia, -(DIAS_MEDICION - 1))}T00:00:00Z`) - Date.parse(`${hoy}T00:00:00Z`)) / 86_400_000) + 1),
      hrefDetalle: `/panel/optimizacion/${c.itemId}?cuenta=${c.cuentaMlId ?? ""}#bitacora`,
    };
  });

  const sufijo = cuentaId ? `?cuenta=${cuentaId}` : "";
  const hrefPagina = (p: number) => {
    const u = new URLSearchParams();
    for (const [k, v] of Object.entries({ cuenta: cuentaId ?? "", accion, quien, desde, hasta, estado, q })) if (v) u.set(k, v);
    if (p > 1) u.set("pagina", String(p));
    return `/panel/optimizacion/bitacora${u.toString() ? `?${u}` : ""}`;
  };

  return (
    <>
      <EncabezadoPagina
        titulo="Optimización"
        descripcion={`Cada cambio hecho desde Optimización (últimos ${DIAS_MAXIMOS_BITACORA} días). El resultado sale al día 8: 7 días antes vs. 7 días después.`}
      />
      <Pestanas
        pestanas={[
          { etiqueta: "Publicaciones", href: `/panel/optimizacion${sufijo}`, activa: false },
          { etiqueta: "Bitácora", href: `/panel/optimizacion/bitacora${sufijo}`, activa: true },
        ]}
      />
      <div className={styles.filtros}>
        <SelectorCuentaMl empresaId={empresa.id} cuenta={cuentaParam} />
      </div>
      <Tarjeta>
        <form method="get" action="/panel/optimizacion/bitacora" className={styles.filtros}>
          {cuentaId ? <input type="hidden" name="cuenta" value={cuentaId} /> : null}
          <label>
            Tipo de cambio
            <select className="zx-control" name="accion" defaultValue={accion ?? ""}>
              <option value="">Todos</option>
              {Object.entries(ACCIONES_BITACORA).map(([id, rotulo]) => (
                <option key={id} value={id}>{rotulo}</option>
              ))}
            </select>
          </label>
          <label>
            Quién
            <select className="zx-control" name="quien" defaultValue={quien ?? ""}>
              <option value="">Todos</option>
              {actores.filter((a) => a.valor !== "sistema").map((a) => (
                <option key={a.valor} value={a.valor}>{a.nombre}</option>
              ))}
            </select>
          </label>
          <label>
            Desde
            <input className="zx-control" type="date" name="desde" defaultValue={desde ?? ""} min={restarDiasIso(hoy, DIAS_MAXIMOS_BITACORA - 1)} max={hoy} />
          </label>
          <label>
            Hasta
            <input className="zx-control" type="date" name="hasta" defaultValue={hasta ?? ""} max={hoy} />
          </label>
          <label>
            Estado
            <select className="zx-control" name="estado" defaultValue={estado ?? ""}>
              <option value="">Todos</option>
              {ESTADOS_BITACORA.map((e) => (
                <option key={e} value={e}>{ROTULO_ESTADO[e]}</option>
              ))}
            </select>
          </label>
          <label>
            Publicación
            <input className="zx-control" type="search" name="q" defaultValue={q} maxLength={40} placeholder="Ej.: MCO123" />
          </label>
          <Boton type="submit">Filtrar</Boton>
        </form>
        {filas.length === 0 ? (
          <EstadoVacio>No hay cambios con esos filtros.</EstadoVacio>
        ) : (
          <>
            <p className={styles.nota}>{`${resultado.total} ${resultado.total === 1 ? "cambio" : "cambios"}. Las filas anteriores a esta vista no guardaron la cuenta.`}</p>
            <TablaBitacoraGeneral filas={filas} />
            {resultado.paginas > 1 ? (
              <div className={styles.paginacion}>
                {resultado.pagina > 1 ? <Link className={styles.enlace} href={hrefPagina(resultado.pagina - 1)}>← Anterior</Link> : null}
                <span>{`Página ${resultado.pagina} de ${resultado.paginas}`}</span>
                {resultado.pagina < resultado.paginas ? <Link className={styles.enlace} href={hrefPagina(resultado.pagina + 1)}>Siguiente →</Link> : null}
              </div>
            ) : null}
          </>
        )}
      </Tarjeta>
    </>
  );
}
