import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import Link from "next/link";
import { listarEmpresasDeUsuario } from "@/lib/empresas";
import { obtenerMiMembresia } from "@/lib/membresias";
import { obtenerOCrearUsuarioActual } from "@/lib/usuarios";
import { requierePermiso, SinPermisoError } from "@/lib/permisos";
import { listarSkus, listarPublicacionesSinSku } from "@/lib/ml/sku";
import { vincularAction } from "./actions";
import { Boton, BotonLink } from "@/components/marco/Boton";
import { EncabezadoPagina } from "@/components/marco/EncabezadoPagina";
import { EstadoVacio } from "@/components/marco/EstadoVacio";
import { FilaLista, ListaFilas } from "@/components/marco/ListaFilas";
import { SinAcceso } from "@/components/marco/SinAcceso";
import styles from "./page.module.css";

// Tarea 2.6 — pantalla que pide el criterio de "listo": "ninguna
// publicación de Mateo queda sin SKU". Se enlaza cada una a mano a un
// SKU ya creado — crear el SKU en sí es /panel/sku.
export default async function PublicacionesSinSkuPage() {
  const usuario = await obtenerOCrearUsuarioActual();
  if (!usuario) redirect("/sign-in");

  const propias = await listarEmpresasDeUsuario(usuario.id);
  const empresaId = cookies().get("empresa_actual")?.value;
  const empresa = propias.find((e) => e.id === empresaId) ?? propias[0];
  if (!empresa) redirect("/crear-empresa");

  try {
    await requierePermiso(usuario.id, empresa.id, "inventario", "modificar");
  } catch (error) {
    if (!(error instanceof SinPermisoError)) throw error;
    const miMembresia = await obtenerMiMembresia(usuario.id, empresa.id);
    return (
      <SinAcceso mensaje={`Tu rol (${miMembresia?.rolNombre ?? "sin rol"}) no puede enlazar SKUs.`} volverHref="/panel/sku" volverTexto="Volver" />
    );
  }

  const [publicaciones, skus] = await Promise.all([listarPublicacionesSinSku(empresa.id), listarSkus(empresa.id)]);

  return (
    <>
      <EncabezadoPagina titulo="Publicaciones sin SKU" />

      {publicaciones.length === 0 ? (
        <EstadoVacio>Todas las publicaciones ya tienen un SKU enlazado.</EstadoVacio>
      ) : skus.length === 0 ? (
        <EstadoVacio>
          Todavía no has creado ningún SKU — <Link href="/panel/sku">créalos acá primero</Link>.
        </EstadoVacio>
      ) : (
        <ListaFilas>
          {publicaciones.map((publicacion) => (
            <FilaLista key={publicacion.id}>
              <div className={styles.titulo}>
                {publicacion.titulo} — ${publicacion.precio} · stock {publicacion.stock}
              </div>
              <form action={vincularAction} className={styles.form}>
                <input type="hidden" name="publicacionId" value={publicacion.id} />
                <select name="skuId" required className={`zx-control ${styles.select}`}>
                  <option value="">Elegir SKU…</option>
                  {skus.map((sku) => (
                    <option key={sku.id} value={sku.id}>
                      {sku.codigo} — {sku.nombre}
                    </option>
                  ))}
                </select>
                <Boton type="submit" chico>
                  Enlazar
                </Boton>
              </form>
            </FilaLista>
          ))}
        </ListaFilas>
      )}

      <BotonLink href="/panel/sku" variante="fantasma" chico className={styles.volver}>
        Volver a SKU
      </BotonLink>
    </>
  );
}
