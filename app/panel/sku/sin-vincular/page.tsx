import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import Link from "next/link";
import { listarEmpresasDeUsuario } from "@/lib/empresas";
import { obtenerMiMembresia } from "@/lib/membresias";
import { obtenerOCrearUsuarioActual } from "@/lib/usuarios";
import { requierePermiso, SinPermisoError } from "@/lib/permisos";
import { listarSkus, listarPublicacionesSinSku } from "@/lib/ml/sku";
import { vincularAction } from "./actions";

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
      <main style={{ maxWidth: 480, margin: "0 auto", padding: "48px 24px" }}>
        <p>Tu rol ({miMembresia?.rolNombre ?? "sin rol"}) no puede enlazar SKUs.</p>
        <Link href="/panel/sku">Volver</Link>
      </main>
    );
  }

  const [publicaciones, skus] = await Promise.all([listarPublicacionesSinSku(empresa.id), listarSkus(empresa.id)]);

  return (
    <main style={{ maxWidth: 560, margin: "0 auto", padding: "48px 24px" }}>
      <h1 style={{ fontSize: 20, fontWeight: 700 }}>Publicaciones sin SKU</h1>

      {publicaciones.length === 0 ? (
        <p style={{ opacity: 0.7, fontSize: 14 }}>Todas las publicaciones ya tienen un SKU enlazado.</p>
      ) : skus.length === 0 ? (
        <p style={{ opacity: 0.7, fontSize: 14 }}>
          Todavía no has creado ningún SKU — <Link href="/panel/sku">créalos acá primero</Link>.
        </p>
      ) : (
        <ul style={{ listStyle: "none", padding: 0, marginTop: 20 }}>
          {publicaciones.map((publicacion) => (
            <li key={publicacion.id} style={{ padding: "10px 0", borderBottom: "1px solid #eee" }}>
              <div style={{ fontSize: 14 }}>
                {publicacion.titulo} — ${publicacion.precio} · stock {publicacion.stock}
              </div>
              <form action={vincularAction} style={{ display: "flex", gap: 8, marginTop: 6 }}>
                <input type="hidden" name="publicacionId" value={publicacion.id} />
                <select name="skuId" required style={{ flex: 1, padding: 6 }}>
                  <option value="">Elegir SKU…</option>
                  {skus.map((sku) => (
                    <option key={sku.id} value={sku.id}>
                      {sku.codigo} — {sku.nombre}
                    </option>
                  ))}
                </select>
                <button type="submit" style={{ padding: "6px 12px" }}>
                  Enlazar
                </button>
              </form>
            </li>
          ))}
        </ul>
      )}

      <p style={{ marginTop: 24 }}>
        <Link href="/panel/sku" style={{ fontSize: 13 }}>
          Volver a SKU
        </Link>
      </p>
    </main>
  );
}
