import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import Link from "next/link";
import { desc, eq } from "drizzle-orm";
import { dbComoEmpresa } from "@/db/empresa-context";
import { productosMl } from "@/db/schema";
import { listarEmpresasDeUsuario } from "@/lib/empresas";
import { obtenerMiMembresia } from "@/lib/membresias";
import { obtenerOCrearUsuarioActual } from "@/lib/usuarios";
import { requierePermiso, SinPermisoError } from "@/lib/permisos";

const ETIQUETA_ESTADO: Record<string, string> = {
  borrador: "Borrador",
  publicando: "Publicando…",
  publicado: "Publicado",
  con_errores: "Con errores",
};

// Tarea 2.11 ("Publicar producto y clip") — historial de intentos de
// publicación. Cada fila es una de las cuentas elegidas; el resultado
// detallado (atributos asumidos, avisos, diagnóstico de fallos) vive en
// /panel/publicar/[id].
export default async function PublicarPage() {
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

  const historial = await dbComoEmpresa(empresa.id, (tx) =>
    tx.select().from(productosMl).where(eq(productosMl.empresaId, empresa.id)).orderBy(desc(productosMl.creadoTs))
  );

  return (
    <main style={{ maxWidth: 560, margin: "0 auto", padding: "48px 24px" }}>
      <h1 style={{ fontSize: 24, fontWeight: 700 }}>Publicar en Mercado Libre</h1>

      <div style={{ display: "flex", gap: 16, marginTop: 16, fontSize: 13 }}>
        <Link href="/panel/publicar/nuevo" style={{ fontWeight: 600 }}>
          + Publicar producto nuevo
        </Link>
        <Link href="/panel/publicar/clip">Subir Clip a una publicación existente</Link>
      </div>

      <ul style={{ listStyle: "none", padding: 0, marginTop: 24 }}>
        {historial.map((p) => (
          <li key={p.id} style={{ padding: "10px 0", borderBottom: "1px solid #eee", fontSize: 14 }}>
            <Link href={`/panel/publicar/${p.id}`}>
              <strong>{p.titulo || "(sin título)"}</strong>
              <span style={{ opacity: 0.6, marginLeft: 8, fontSize: 12 }}>{ETIQUETA_ESTADO[p.estado] ?? p.estado}</span>
            </Link>
          </li>
        ))}
        {historial.length === 0 && <p style={{ opacity: 0.7, fontSize: 14 }}>Todavía no se publicó ningún producto.</p>}
      </ul>

      <p style={{ marginTop: 24 }}>
        <Link href="/panel/sku" style={{ fontSize: 13 }}>
          Volver a SKU
        </Link>
      </p>
    </main>
  );
}
