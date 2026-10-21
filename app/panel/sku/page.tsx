import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import Link from "next/link";
import { listarEmpresasDeUsuario } from "@/lib/empresas";
import { obtenerMiMembresia } from "@/lib/membresias";
import { obtenerOCrearUsuarioActual } from "@/lib/usuarios";
import { requierePermiso, SinPermisoError } from "@/lib/permisos";
import { listarSkus, listarPublicacionesSinSku } from "@/lib/ml/sku";
import { crearSkuAction } from "./actions";

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
    return (
      <main style={{ maxWidth: 480, margin: "0 auto", padding: "48px 24px" }}>
        <p>Tu rol ({miMembresia?.rolNombre ?? "sin rol"}) no tiene acceso a esta pantalla.</p>
        <Link href="/panel">Volver al panel</Link>
      </main>
    );
  }

  const [skus, publicacionesSinSku] = await Promise.all([listarSkus(empresa.id), listarPublicacionesSinSku(empresa.id)]);

  return (
    <main style={{ maxWidth: 560, margin: "0 auto", padding: "48px 24px" }}>
      <h1 style={{ fontSize: 24, fontWeight: 700 }}>SKU</h1>

      {publicacionesSinSku.length > 0 && (
        <div style={{ padding: 10, background: "#fff8e1", borderRadius: 6, fontSize: 14, marginTop: 16 }}>
          {publicacionesSinSku.length} publicación(es) sin SKU todavía.{" "}
          <Link href="/panel/sku/sin-vincular" style={{ fontWeight: 600 }}>
            Enlazarlas
          </Link>
        </div>
      )}

      <form action={crearSkuAction} style={{ display: "flex", flexDirection: "column", gap: 10, marginTop: 24 }}>
        <label style={{ fontSize: 13 }}>
          Código
          <input name="codigo" id="sku-codigo" required style={{ display: "block", width: "100%", padding: 8, marginTop: 4 }} />
        </label>
        <label style={{ fontSize: 13 }}>
          Nombre
          <input name="nombre" id="sku-nombre" required style={{ display: "block", width: "100%", padding: 8, marginTop: 4 }} />
        </label>
        <label style={{ fontSize: 13 }}>
          Producto base (opcional — agrupa variantes, ej. "Camiseta")
          <input name="nombreBase" id="sku-nombre-base" style={{ display: "block", width: "100%", padding: 8, marginTop: 4 }} />
        </label>
        <button type="submit" style={{ padding: "8px 14px", alignSelf: "flex-start" }}>
          Crear SKU
        </button>
      </form>

      <ul style={{ listStyle: "none", padding: 0, marginTop: 24 }}>
        {skus.map((sku) => (
          <li key={sku.id} style={{ padding: "8px 0", borderBottom: "1px solid #eee", fontSize: 14 }}>
            <strong>{sku.codigo}</strong> — {sku.nombre}
            {sku.nombreBase && <span style={{ opacity: 0.6 }}> ({sku.nombreBase})</span>}
            {sku.esKit && <span style={{ opacity: 0.6 }}> · kit</span>}
          </li>
        ))}
      </ul>

      <p style={{ marginTop: 24 }}>
        <Link href="/panel" style={{ fontSize: 13 }}>
          Volver al panel
        </Link>
      </p>
    </main>
  );
}
