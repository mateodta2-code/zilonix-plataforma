import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import Link from "next/link";
import { listarEmpresasDeUsuario } from "@/lib/empresas";
import { obtenerMiMembresia } from "@/lib/membresias";
import { obtenerOCrearUsuarioActual } from "@/lib/usuarios";
import { requierePermiso, SinPermisoError } from "@/lib/permisos";
import { listarSkus, listarPublicacionesSinSku } from "@/lib/ml/sku";
import { crearSkuAction } from "./actions";
import { Boton, BotonLink } from "@/components/marco/Boton";
import { Campo } from "@/components/marco/Campo";
import { Chip } from "@/components/marco/Chip";
import { EncabezadoPagina } from "@/components/marco/EncabezadoPagina";
import { EstadoVacio } from "@/components/marco/EstadoVacio";
import { FilaLista, ListaFilas } from "@/components/marco/ListaFilas";
import { SinAcceso } from "@/components/marco/SinAcceso";
import { Tarjeta } from "@/components/marco/Tarjeta";
import styles from "./page.module.css";

// Tarea 2.6 — SKU maestro. "Variantes" son SKUs propios agrupados por
// nombreBase, no una tabla aparte (ver db/schema.ts).
export default async function SkuPage() {
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

  const [skus, publicacionesSinSku] = await Promise.all([listarSkus(empresa.id), listarPublicacionesSinSku(empresa.id)]);

  return (
    <>
      <EncabezadoPagina titulo="SKU" />

      {publicacionesSinSku.length > 0 && (
        <div className={styles.avisoSinVincular}>
          {publicacionesSinSku.length} publicación(es) sin SKU todavía.{" "}
          <Link href="/panel/sku/sin-vincular" className={styles.enlaceAviso}>
            Enlazarlas
          </Link>
        </div>
      )}

      <Tarjeta>
        <form action={crearSkuAction} className={styles.form}>
          <Campo etiqueta="Código">
            <input name="codigo" id="sku-codigo" required className="zx-control" />
          </Campo>
          <Campo etiqueta="Nombre">
            <input name="nombre" id="sku-nombre" required className="zx-control" />
          </Campo>
          <Campo etiqueta='Producto base (opcional — agrupa variantes, ej. "Camiseta")'>
            <input name="nombreBase" id="sku-nombre-base" className="zx-control" />
          </Campo>
          <Boton type="submit" className={styles.botonCrear}>
            Crear SKU
          </Boton>
        </form>
      </Tarjeta>

      {skus.length === 0 ? (
        <EstadoVacio>Todavía no has creado ningún SKU.</EstadoVacio>
      ) : (
        <ListaFilas>
          {skus.map((sku) => (
            <FilaLista key={sku.id}>
              <span className={styles.filaSku}>
                <strong>{sku.codigo}</strong> — {sku.nombre}
                {sku.nombreBase && <span className={styles.detalleSku}> ({sku.nombreBase})</span>}
                {sku.esKit && <Chip>Kit</Chip>}
              </span>
            </FilaLista>
          ))}
        </ListaFilas>
      )}

      <BotonLink href="/panel" variante="fantasma" chico className={styles.volver}>
        Volver al panel
      </BotonLink>
    </>
  );
}
