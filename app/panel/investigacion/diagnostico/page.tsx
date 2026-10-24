import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { listarEmpresasDeUsuario } from "@/lib/empresas";
import { obtenerMiMembresia } from "@/lib/membresias";
import { obtenerOCrearUsuarioActual } from "@/lib/usuarios";
import { requierePermiso, SinPermisoError } from "@/lib/permisos";
import { diagnosticarCatalogo, diagnosticarItem, diagnosticarVendedor } from "@/lib/ml/diagnostico";
import type { DiagnosticoCatalogoMl, DiagnosticoItemMl, DiagnosticoVendedorMl } from "@/lib/ml/cliente";
import { Boton, BotonLink } from "@/components/marco/Boton";
import { Campo } from "@/components/marco/Campo";
import { EncabezadoPagina } from "@/components/marco/EncabezadoPagina";
import { EstadoVacio } from "@/components/marco/EstadoVacio";
import { SinAcceso } from "@/components/marco/SinAcceso";
import { Tarjeta } from "@/components/marco/Tarjeta";
import styles from "./page.module.css";

// Issue #175, punto 4 — "antes de escribir el lector, confirma en vivo
// qué endpoints responden": esta pantalla ES esa confirmación, nunca
// el lector real. Prueba contra la API real de Mercado Libre con el
// token de la cuenta ML PROPIA ya conectada a la empresa (lib/ml/
// diagnostico.ts: obtenerCuentaMlActiva + obtenerAccessTokenVigente,
// mismo camino que investigacion.ts) y muestra el status HTTP y los
// campos crudos tal como vienen — nunca el token, que no sale de
// lib/ml/diagnostico.ts hacia esta página.
//
// Mismo candado "solo Dueño" que /panel/roles (configuracion.autorizar
// — ninguna plantilla de rol lo concede, solo el rol que nace con la
// empresa, ver lib/roles-plantillas.ts): golpear la API real de
// Mercado Libre con el token de la empresa, a mano y con ids sueltos,
// no es para cualquier rol.
//
// Herramienta temporal — queda pendiente de borrar una vez confirmados
// los 3 puntos del issue #175 y construido el lector real.
export default async function DiagnosticoInvestigacionPage({
  searchParams,
}: {
  searchParams: { itemId?: string; sellerId?: string; productId?: string };
}) {
  const usuario = await obtenerOCrearUsuarioActual();
  if (!usuario) redirect("/sign-in");

  const propias = await listarEmpresasDeUsuario(usuario.id);
  const empresaId = cookies().get("empresa_actual")?.value;
  const empresa = propias.find((e) => e.id === empresaId) ?? propias[0];
  if (!empresa) redirect("/crear-empresa");

  try {
    await requierePermiso(usuario.id, empresa.id, "configuracion", "autorizar");
  } catch (error) {
    if (!(error instanceof SinPermisoError)) throw error;
    const miMembresia = await obtenerMiMembresia(usuario.id, empresa.id);
    return <SinAcceso mensaje={`Tu rol (${miMembresia?.rolNombre ?? "sin rol"}) no tiene acceso a esta pantalla.`} />;
  }

  const itemId = searchParams.itemId?.trim() ?? "";
  const sellerId = searchParams.sellerId?.trim() ?? "";
  const productId = searchParams.productId?.trim() ?? "";

  let resultadoItem: DiagnosticoItemMl | null = null;
  let errorItem: string | null = null;
  if (itemId) {
    try {
      resultadoItem = await diagnosticarItem(empresa.id, itemId);
    } catch (error) {
      errorItem = mensajeDeError(error);
    }
  }

  let resultadoVendedor: DiagnosticoVendedorMl | null = null;
  let errorVendedor: string | null = null;
  if (sellerId) {
    try {
      resultadoVendedor = await diagnosticarVendedor(empresa.id, sellerId);
    } catch (error) {
      errorVendedor = mensajeDeError(error);
    }
  }

  let resultadoCatalogo: DiagnosticoCatalogoMl | null = null;
  let errorCatalogo: string | null = null;
  if (productId) {
    try {
      resultadoCatalogo = await diagnosticarCatalogo(empresa.id, productId);
    } catch (error) {
      errorCatalogo = mensajeDeError(error);
    }
  }

  return (
    <>
      <EncabezadoPagina
        titulo="Diagnóstico de Investigación"
        descripcion="Herramienta temporal (issue #175): confirma qué endpoints de Mercado Libre responden de verdad para publicaciones y tiendas ajenas, antes de construir el seguimiento real."
      />

      <Tarjeta className={styles.formulario}>
        <p className={styles.tituloSeccion}>1. Publicación ajena — GET /items/:id</p>
        <form method="get" className={styles.filaFormulario}>
          <input type="hidden" name="sellerId" value={sellerId} />
          <input type="hidden" name="productId" value={productId} />
          <Campo etiqueta="itemId (ej. MCO123456789)">
            <input type="text" name="itemId" defaultValue={itemId} placeholder="MCO123456789" className="zx-control" />
          </Campo>
          <Boton type="submit">Probar</Boton>
        </form>
        {errorItem ? <EstadoVacio>{errorItem}</EstadoVacio> : null}
        {resultadoItem ? (
          <div className={styles.resultado}>
            <p className={styles.ayuda}>status HTTP: {resultadoItem.status}</p>
            <pre className={styles.crudo}>{JSON.stringify(resultadoItem.data, null, 2)}</pre>
          </div>
        ) : null}
      </Tarjeta>

      <Tarjeta className={styles.formulario}>
        <p className={styles.tituloSeccion}>2. Tienda/vendedor ajeno — búsqueda por seller_id</p>
        <form method="get" className={styles.filaFormulario}>
          <input type="hidden" name="itemId" value={itemId} />
          <input type="hidden" name="productId" value={productId} />
          <Campo etiqueta="seller_id (solo dígitos)">
            <input type="text" name="sellerId" defaultValue={sellerId} placeholder="123456789" className="zx-control" />
          </Campo>
          <Boton type="submit">Probar</Boton>
        </form>
        {errorVendedor ? <EstadoVacio>{errorVendedor}</EstadoVacio> : null}
        {resultadoVendedor ? (
          <div className={styles.resultado}>
            <p className={styles.ayuda}>
              GET /users/{sellerId}/items/search — status HTTP: {resultadoVendedor.itemsSearch.status}, resultados:{" "}
              {resultadoVendedor.itemsSearch.cantidadResultados ?? "—"}
            </p>
            <p className={styles.ayuda}>
              GET /sites/MCO/search?seller_id={sellerId} — status HTTP: {resultadoVendedor.sitesSearch.status}, resultados:{" "}
              {resultadoVendedor.sitesSearch.cantidadResultados ?? "—"}
            </p>
          </div>
        ) : null}
      </Tarjeta>

      <Tarjeta className={styles.formulario}>
        <p className={styles.tituloSeccion}>3. Ofertas de catálogo — GET /products/:id/items</p>
        <form method="get" className={styles.filaFormulario}>
          <input type="hidden" name="itemId" value={itemId} />
          <input type="hidden" name="sellerId" value={sellerId} />
          <Campo etiqueta="id de catálogo (ej. MCO123456789)">
            <input type="text" name="productId" defaultValue={productId} placeholder="MCO123456789" className="zx-control" />
          </Campo>
          <Boton type="submit">Probar</Boton>
        </form>
        {errorCatalogo ? <EstadoVacio>{errorCatalogo}</EstadoVacio> : null}
        {resultadoCatalogo ? (
          <div className={styles.resultado}>
            <p className={styles.ayuda}>
              status HTTP: {resultadoCatalogo.status}, ofertas: {resultadoCatalogo.totalOfertas ?? "—"}
            </p>
            <p className={styles.ayuda}>
              Campo de &quot;botón de compra&quot; encontrado en la primera oferta:{" "}
              {resultadoCatalogo.camposGanadorEncontrados.length
                ? resultadoCatalogo.camposGanadorEncontrados.map((c) => `${c.clave} = ${JSON.stringify(c.valor)}`).join(", ")
                : "ninguno (no apareció ningún campo con buy_box/winner/gana)"}
            </p>
            <p className={styles.ayuda}>Primera oferta cruda:</p>
            <pre className={styles.crudo}>{JSON.stringify(resultadoCatalogo.primeraOferta, null, 2)}</pre>
          </div>
        ) : null}
      </Tarjeta>

      <BotonLink href="/panel/investigacion" variante="fantasma" chico className={styles.volver}>
        Volver a Investigación
      </BotonLink>
    </>
  );
}

function mensajeDeError(error: unknown): string {
  return error instanceof Error ? error.message : "Error desconocido.";
}
