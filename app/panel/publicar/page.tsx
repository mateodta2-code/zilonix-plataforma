import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { desc, eq } from "drizzle-orm";
import { dbComoEmpresa } from "@/db/empresa-context";
import { productosMl } from "@/db/schema";
import { listarEmpresasDeUsuario } from "@/lib/empresas";
import { obtenerMiMembresia } from "@/lib/membresias";
import { obtenerOCrearUsuarioActual } from "@/lib/usuarios";
import { requierePermiso, SinPermisoError } from "@/lib/permisos";
import { listarCuentasConectadas } from "@/lib/ml/cuentas";
import { linkHttpSeguro } from "@/lib/ml/listadoCliente";
import { SinAcceso } from "@/components/marco/SinAcceso";
import { EncabezadoPagina } from "@/components/marco/EncabezadoPagina";
import { PaginaPublicar } from "./PaginaPublicar";
import type { ProductoHistorial } from "./HistorialPublicaciones";
import { importarItemCompleto } from "./importadores/importar-item";
import type { ItemImportado } from "./formulario-logica";
import { cloudinaryConfigurado } from "@/lib/cloudinary";

// Parte 2 (página única, estructura de Zilonix OS) — reemplaza las 4
// pantallas sueltas de la Parte 1 (/panel/publicar historial,
// /nuevo, /[id], /clip) por UNA sola, de arriba a abajo. Esta página
// (Server Component) solo resuelve sesión/empresa/permiso, trae las
// cuentas conectadas y el historial (últimos 50), y lee el único juego
// de query params que todavía puede llegar de afuera: el prefill de
// Investigación (titulo/precio/foto, reenviado por el redirect de
// /nuevo — ver ese page.tsx). Rama feat-publicar-clip — el prefill de
// Clip por query param (cuentaId/sku/itemId/clipSubido/error) se
// retiró: SeccionClip.tsx ahora busca/sube/consulta estado por su
// cuenta, con fetch del lado del cliente, nunca con un redirect de
// vuelta acá. Todo el estado INTERACTIVO (qué cuenta está marcada, qué
// producto se cargó para reintentar...) vive en PaginaPublicar.tsx
// ("use client"), porque "Cargar/Reintentar" y "Duplicar" necesitan
// repoblar el formulario de arriba SIN navegar — no hay forma de hacer
// eso con una Server Action sola.
export default async function PublicarPage({
  searchParams,
}: {
  searchParams: {
    titulo?: string;
    precio?: string;
    foto?: string;
    importarItemId?: string;
    importarCuentaId?: string;
    importarOrigen?: string;
    importarSkuNoEncontrado?: string;
    importarLinkError?: string;
  };
}) {
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

  const cuentas = (await listarCuentasConectadas(empresa.id)).filter((c) => !c.desconectadaTs);

  const filasHistorial = await dbComoEmpresa(empresa.id, (tx) =>
    tx.select().from(productosMl).where(eq(productosMl.empresaId, empresa.id)).orderBy(desc(productosMl.creadoTs)).limit(50)
  );
  // Punto 8 del pedido — "Paginar o limitar a los últimos 50" (arriba,
  // .limit(50)); acá solo se adapta la forma de la fila (jsonb ya
  // viene tipado por db/schema.ts, timestamp pasa a ISO string al
  // cruzar a un componente cliente) — nunca una consulta nueva.
  const historial: ProductoHistorial[] = filasHistorial.map((p) => ({
    id: p.id,
    titulo: p.titulo,
    estado: p.estado,
    creadoTs: p.creadoTs.toISOString(),
    precio: p.precio,
    stock: p.stock,
    condicion: p.condicion,
    envioGratis: p.envioGratis,
    sku: p.sku,
    dimensiones: p.dimensiones,
    imagenes: p.imagenes,
    atributosExtra: p.atributosExtra,
    categoriasOverride: p.categoriasOverride,
    variantes: p.variantes,
    porCuenta: p.porCuenta,
    cuentasSeleccionadas: p.cuentasSeleccionadas,
    resultado: p.resultado,
    modoPrueba: p.modoPrueba,
  }));

  // Punto 8 del pedido original (Investigación → Publicar, ya
  // vigente desde la Parte 1) — título/precio van directo a un
  // <input> de React (nunca innerHTML); la foto se sanea con
  // linkHttpSeguro (mismo helper de siempre) antes de usarla.
  const prefillNuevo = {
    titulo: (searchParams.titulo ?? "").slice(0, 60),
    precio: searchParams.precio && Number.isFinite(Number(searchParams.precio)) ? searchParams.precio : "",
    foto: linkHttpSeguro(searchParams.foto ?? null) ?? "",
  };

  // Rama feat-publicar-clip — SeccionClip.tsx ahora busca por SKU,
  // sube y consulta estado por su cuenta (fetch del cliente a los
  // Route Handlers nuevos bajo app/api/ml/clip/), nunca con un
  // query param resuelto acá del lado del servidor como antes.
  const clipHabilitado = process.env.CLIP_HABILITADO === "true";

  // Parte 3, punto A — importarItemId/importarCuentaId llegan de
  // importadores/actions.ts (por SKU o por link, ver importarOrigen).
  // El lookup real (importarItemCompleto) sigue siendo SOLO del
  // servidor (token de la cuenta) — mismo criterio que itemClip arriba.
  // null = Mercado Libre no deja traer ese ítem por la API (403/404,
  // típico de una publicación ajena) — la UI manda a usar el
  // bookmarklet/extensión en su lugar, nunca se reintenta scrapeando.
  let itemImportado: ItemImportado | null = null;
  let importarNoDisponible = false;
  const cuentaImportar = cuentas.find((c) => c.id === searchParams.importarCuentaId);
  if (cuentaImportar && searchParams.importarItemId) {
    itemImportado = await importarItemCompleto(empresa.id, cuentaImportar.id, searchParams.importarItemId);
    importarNoDisponible = itemImportado === null;
  }

  return (
    <>
      <EncabezadoPagina
        titulo="Publicar en Mercado Libre"
        descripcion="Elige las cuentas destino — cada una tiene su propio título, descripción y foto de portada. Precio, stock, SKU y el resto de fotos son iguales para todas. Publicación tipo Premium con garantía del vendedor de 30 días, siempre."
      />
      <PaginaPublicar
        cuentas={cuentas.map((c) => ({ id: c.id, nickname: c.nickname }))}
        historial={historial}
        prefillNuevo={prefillNuevo}
        clipHabilitado={clipHabilitado}
        itemImportado={itemImportado}
        importarOrigen={searchParams.importarOrigen ?? ""}
        importarSkuNoEncontrado={searchParams.importarSkuNoEncontrado ?? ""}
        importarLinkError={searchParams.importarLinkError ?? ""}
        importarNoDisponible={importarNoDisponible}
        cloudinaryConfigurado={cloudinaryConfigurado()}
      />
    </>
  );
}
