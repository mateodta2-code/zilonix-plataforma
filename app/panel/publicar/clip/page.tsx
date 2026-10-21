import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import Link from "next/link";
import { listarEmpresasDeUsuario } from "@/lib/empresas";
import { obtenerMiMembresia } from "@/lib/membresias";
import { obtenerOCrearUsuarioActual } from "@/lib/usuarios";
import { requierePermiso, SinPermisoError } from "@/lib/permisos";
import { listarCuentasConectadas } from "@/lib/ml/cuentas";
import { buscarItemAction, buscarItemConDatos, cambiarEstadoAction, subirClipAction } from "./actions";

// Tarea 2.11 ("Publicar producto y clip") — el Clip es un sub-flujo
// APARTE de publicar (decisión de diseño explícita del sistema actual:
// siempre se aplica a un ítem que YA existe, nunca al crearlo). Se
// aprovecha el mismo lugar para pausar/activar esa publicación — ambas
// acciones parten de tener resuelto el item_id real.
export default async function PublicarClipPage({ searchParams }: { searchParams: { cuentaId?: string; sku?: string; itemId?: string; clipSubido?: string } }) {
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

  const cuentas = (await listarCuentasConectadas(empresa.id)).filter((c) => !c.desconectadaTs);
  const cuentaElegida = cuentas.find((c) => c.id === searchParams.cuentaId);

  let item: { itemId: string; titulo: string; thumbnail: string | null } | null = null;
  if (cuentaElegida && searchParams.sku) {
    item = await buscarItemConDatos(empresa.id, cuentaElegida.id, cuentaElegida.cuentaIdExterna, searchParams.sku);
  } else if (cuentaElegida && searchParams.itemId) {
    item = { itemId: searchParams.itemId, titulo: searchParams.itemId, thumbnail: null };
  }

  return (
    <main style={{ maxWidth: 480, margin: "0 auto", padding: "48px 24px" }}>
      <h1 style={{ fontSize: 24, fontWeight: 700 }}>Subir Clip a una publicación</h1>
      <p style={{ fontSize: 13, opacity: 0.7 }}>
        Mercado Libre modera el video (24-48h) antes de que quede visible — esto solo confirma que quedó recibido.
      </p>

      <form action={buscarItemAction} style={{ marginTop: 20, display: "flex", flexDirection: "column", gap: 10 }}>
        <label style={{ fontSize: 13 }}>
          Cuenta
          <select name="cuentaId" defaultValue={cuentaElegida?.id} style={{ display: "block", width: "100%", padding: 8, marginTop: 4 }}>
            {cuentas.map((c) => (
              <option key={c.id} value={c.id}>
                {c.nickname}
              </option>
            ))}
          </select>
        </label>
        <label style={{ fontSize: 13 }}>
          SKU de la publicación ya existente
          <input name="sku" defaultValue={searchParams.sku} required style={{ display: "block", width: "100%", padding: 8, marginTop: 4 }} />
        </label>
        <button type="submit" style={{ padding: "8px 14px", alignSelf: "flex-start" }}>
          Buscar
        </button>
      </form>

      {searchParams.sku && !item && <p style={{ marginTop: 16, color: "#b00020", fontSize: 14 }}>No se encontró ninguna publicación con ese SKU en esa cuenta.</p>}

      {item && cuentaElegida && (
        <div style={{ marginTop: 24, borderTop: "1px solid #eee", paddingTop: 16 }}>
          <p style={{ fontSize: 14 }}>
            <strong>{item.titulo}</strong> ({item.itemId})
          </p>
          {searchParams.clipSubido && <p style={{ color: "#1a7f37", fontSize: 13 }}>Clip subido — queda en moderación 24-48h.</p>}

          <form action={subirClipAction} encType="multipart/form-data" style={{ marginTop: 12, display: "flex", flexDirection: "column", gap: 10 }}>
            <input type="hidden" name="cuentaId" value={cuentaElegida.id} />
            <input type="hidden" name="itemId" value={item.itemId} />
            <label style={{ fontSize: 13 }}>
              Video (MP4/MOV/MPEG/AVI, 10-61 segundos, vertical, máx. 280MB)
              <input type="file" name="archivo" accept="video/mp4,video/quicktime,video/mpeg,video/x-msvideo" required style={{ display: "block", marginTop: 4 }} />
            </label>
            <button type="submit" style={{ padding: "8px 14px", alignSelf: "flex-start" }}>
              Subir Clip
            </button>
          </form>

          <form action={cambiarEstadoAction} style={{ marginTop: 16, display: "flex", gap: 8 }}>
            <input type="hidden" name="cuentaId" value={cuentaElegida.id} />
            <input type="hidden" name="itemId" value={item.itemId} />
            <button type="submit" name="activar" value="0" style={{ padding: "6px 12px", fontSize: 13 }}>
              Pausar publicación
            </button>
            <button type="submit" name="activar" value="1" style={{ padding: "6px 12px", fontSize: 13 }}>
              Activar publicación
            </button>
          </form>
        </div>
      )}

      <p style={{ marginTop: 24 }}>
        <Link href="/panel/publicar" style={{ fontSize: 13 }}>
          Volver
        </Link>
      </p>
    </main>
  );
}
