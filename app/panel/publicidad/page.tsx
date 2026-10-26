import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { desc, eq } from "drizzle-orm";
import { dbComoEmpresa } from "@/db/empresa-context";
import { publicidadAnunciantes, publicidadSincronizaciones } from "@/db/schema";
import { listarEmpresasDeUsuario } from "@/lib/empresas";
import { obtenerMiMembresia } from "@/lib/membresias";
import { obtenerOCrearUsuarioActual } from "@/lib/usuarios";
import { requierePermiso, SinPermisoError } from "@/lib/permisos";
import { SUGERENCIA_RECONECTAR_PUBLICIDAD } from "@/lib/ml/publicidad";
import { leerCuentaMlDeQuery } from "@/lib/ml/selector-cuenta";
import { SelectorCuentaMl } from "@/components/SelectorCuentaMl";
import { Boton, BotonLink } from "@/components/marco/Boton";
import { EncabezadoPagina } from "@/components/marco/EncabezadoPagina";
import { EstadoVacio } from "@/components/marco/EstadoVacio";
import { SinAcceso } from "@/components/marco/SinAcceso";
import { actualizarPublicidadAction } from "./actions";

// Issue #254 — pantalla mínima para probar el refresco manual. La
// vista de campañas (fase 2) no vive acá. El candado es
// requierePermiso(..., "publicidad", "consultar") antes de leer.

type ParametroUrl = string | string[] | undefined;

function primero(valor: ParametroUrl): string | undefined {
  if (typeof valor === "string") return valor;
  if (Array.isArray(valor)) return valor.find((v) => typeof v === "string");
  return undefined;
}

function fechaBogota(fecha: Date | null): string {
  if (!fecha) return "—";
  return fecha.toLocaleString("es-CO", { timeZone: "America/Bogota" });
}

export default async function PublicidadPage({
  searchParams,
}: {
  searchParams?: { cuenta?: ParametroUrl; aviso?: ParametroUrl };
}) {
  const usuario = await obtenerOCrearUsuarioActual();
  if (!usuario) redirect("/sign-in");

  const propias = await listarEmpresasDeUsuario(usuario.id);
  const empresaId = cookies().get("empresa_actual")?.value;
  const empresa = propias.find((e) => e.id === empresaId) ?? propias[0];
  if (!empresa) redirect("/crear-empresa");

  try {
    await requierePermiso(usuario.id, empresa.id, "publicidad", "consultar");
  } catch (error) {
    if (!(error instanceof SinPermisoError)) throw error;
    const miMembresia = await obtenerMiMembresia(usuario.id, empresa.id);
    return (
      <>
        <EncabezadoPagina titulo="Publicidad" />
        <SinAcceso mensaje={`Tu rol (${miMembresia?.rolNombre ?? "sin rol"}) no tiene acceso a este módulo.`} />
      </>
    );
  }

  const cuentaParam = primero(searchParams?.cuenta);
  const aviso = primero(searchParams?.aviso);
  const { cuentaId } = await leerCuentaMlDeQuery(empresa.id, cuentaParam);

  const anunciante = cuentaId
    ? (
        await dbComoEmpresa(empresa.id, (tx) =>
          tx
            .select({
              estadoAcceso: publicidadAnunciantes.estadoAcceso,
              nombre: publicidadAnunciantes.nombre,
              siteId: publicidadAnunciantes.siteId,
              verificadoTs: publicidadAnunciantes.verificadoTs,
            })
            .from(publicidadAnunciantes)
            .where(eq(publicidadAnunciantes.cuentaMlId, cuentaId))
        )
      )[0]
    : undefined;

  const ultima = cuentaId
    ? (
        await dbComoEmpresa(empresa.id, (tx) =>
          tx
            .select({
              estado: publicidadSincronizaciones.estado,
              rangoDesde: publicidadSincronizaciones.rangoDesde,
              rangoHasta: publicidadSincronizaciones.rangoHasta,
              error: publicidadSincronizaciones.error,
              iniciadaTs: publicidadSincronizaciones.iniciadaTs,
            })
            .from(publicidadSincronizaciones)
            .where(eq(publicidadSincronizaciones.cuentaMlId, cuentaId))
            .orderBy(desc(publicidadSincronizaciones.iniciadaTs))
            .limit(1)
        )
      )[0]
    : undefined;

  const sinPermisoApp = anunciante?.estadoAcceso === "sin_permiso_app";
  const sinProductAds = anunciante?.estadoAcceso === "sin_product_ads";

  return (
    <>
      <EncabezadoPagina
        titulo="Publicidad"
        descripcion="Datos de Product Ads leídos de la API de Mercado Libre. La pantalla de campañas llega en la fase siguiente."
      />
      <SelectorCuentaMl empresaId={empresa.id} cuenta={cuentaParam} parametros={aviso ? { aviso } : undefined} />
      {aviso ? <p style={{ marginTop: 16 }}>{aviso}</p> : null}
      {!cuentaId ? (
        <EstadoVacio>Elegí una cuenta de Mercado Libre para ver su estado y poder actualizarla.</EstadoVacio>
      ) : (
        <div style={{ marginTop: 16, display: "grid", gap: 12 }}>
          {sinPermisoApp ? <p>{SUGERENCIA_RECONECTAR_PUBLICIDAD}</p> : null}
          {sinProductAds ? <p>Esta cuenta no tiene Product Ads activo en Mercado Libre.</p> : null}
          {anunciante?.estadoAcceso === "ok" ? (
            <p>
              Anunciante {anunciante.nombre ?? "sin nombre"} ({anunciante.siteId ?? "sin sitio"}). Última verificación:{" "}
              {fechaBogota(anunciante.verificadoTs)}.
            </p>
          ) : null}
          {ultima ? (
            <p>
              Última corrida: {ultima.estado}
              {ultima.rangoDesde && ultima.rangoHasta ? `, días ${ultima.rangoDesde} a ${ultima.rangoHasta}` : ""}. Iniciada{" "}
              {fechaBogota(ultima.iniciadaTs)}.
              {ultima.error ? ` ${ultima.error}` : ""}
            </p>
          ) : (
            <EstadoVacio>Todavía no hay una sincronización de esta cuenta.</EstadoVacio>
          )}
          <form action={actualizarPublicidadAction}>
            <input type="hidden" name="cuentaMlId" value={cuentaId} />
            <Boton type="submit">Actualizar ahora</Boton>
          </form>
          <p style={{ fontSize: 13, opacity: 0.7 }}>
            Si ya hay una corrida en curso, o una de los últimos 10 minutos, el botón no vuelve a llamar a Mercado Libre.
          </p>
        </div>
      )}
      <div style={{ marginTop: 16 }}>
        <BotonLink href="/panel" variante="fantasma" chico>
          Volver al panel
        </BotonLink>
      </div>
    </>
  );
}
