import { redirect, notFound } from "next/navigation";
import { cookies } from "next/headers";
import Link from "next/link";
import { eq } from "drizzle-orm";
import { dbComoEmpresa } from "@/db/empresa-context";
import { cuentasMl, productosMl } from "@/db/schema";
import { listarEmpresasDeUsuario } from "@/lib/empresas";
import { obtenerMiMembresia } from "@/lib/membresias";
import { obtenerOCrearUsuarioActual } from "@/lib/usuarios";
import { requierePermiso, SinPermisoError } from "@/lib/permisos";
import type { ResultadoPublicacionCuenta } from "@/lib/ml/publicar-tipos";

const ETIQUETA_ESTADO: Record<string, string> = {
  borrador: "Borrador",
  publicando: "Publicando…",
  publicado: "Publicado",
  con_errores: "Con errores",
};

function ResultadoCuenta({ resultado, nickname }: { resultado: ResultadoPublicacionCuenta; nickname: string }) {
  if ("familia" in resultado) {
    return (
      <li style={{ padding: "10px 0", borderBottom: "1px solid #eee", fontSize: 14 }}>
        <strong>{nickname}</strong> — familia &quot;{resultado.familia.familyName}&quot; (esta categoría no admite variantes clásicas)
        <ul style={{ marginTop: 6 }}>
          {resultado.familia.items.map((item, i) => (
            <li key={i} style={{ fontSize: 13, opacity: item.ok ? 1 : 0.8, color: item.ok ? undefined : "#b00020" }}>
              {JSON.stringify(item.valores)} {item.sku ? `(SKU ${item.sku})` : ""} —{" "}
              {item.ok ? (
                <a href={item.permalink} target="_blank" rel="noreferrer">
                  publicado ({item.status})
                </a>
              ) : (
                `error: ${item.error}`
              )}
            </li>
          ))}
        </ul>
      </li>
    );
  }
  if (resultado.ok) {
    return (
      <li style={{ padding: "10px 0", borderBottom: "1px solid #eee", fontSize: 14 }}>
        <strong>{nickname}</strong> —{" "}
        <a href={resultado.permalink} target="_blank" rel="noreferrer">
          publicado ({resultado.status})
        </a>{" "}
        · categoría: {resultado.categoria}
        {resultado.avisoMarca && <p style={{ fontSize: 12, color: "#8a6d00", margin: "4px 0 0" }}>{resultado.avisoMarca}</p>}
        {resultado.avisoFotosVariante && <p style={{ fontSize: 12, color: "#8a6d00", margin: "4px 0 0" }}>{resultado.avisoFotosVariante}</p>}
        {resultado.avisoDescripcion && <p style={{ fontSize: 12, color: "#8a6d00", margin: "4px 0 0" }}>{resultado.avisoDescripcion}</p>}
        {resultado.atributosAsumidos.length > 0 && (
          <details style={{ marginTop: 6, fontSize: 12 }}>
            <summary>{resultado.atributosAsumidos.length} característica(s) que Zilonix completó sola</summary>
            <ul>
              {resultado.atributosAsumidos.map((a) => (
                <li key={a.id}>
                  {a.nombre}: {a.valorAsumido}
                </li>
              ))}
            </ul>
          </details>
        )}
      </li>
    );
  }
  return (
    <li style={{ padding: "10px 0", borderBottom: "1px solid #eee", fontSize: 14 }}>
      <strong>{nickname}</strong> — <span style={{ color: "#b00020" }}>{resultado.error}</span>
      {resultado.bodyEnviado !== undefined && (
        <details style={{ marginTop: 6, fontSize: 12 }}>
          <summary>Ver atributos enviados (diagnóstico)</summary>
          <pre style={{ whiteSpace: "pre-wrap", overflowX: "auto" }}>{JSON.stringify(resultado.bodyEnviado, null, 2)}</pre>
        </details>
      )}
    </li>
  );
}

export default async function PublicarDetallePage({ params }: { params: { id: string } }) {
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

  const [producto] = await dbComoEmpresa(empresa.id, (tx) => tx.select().from(productosMl).where(eq(productosMl.id, params.id)));
  if (!producto) notFound();

  const resultado = (producto.resultado ?? []) as ResultadoPublicacionCuenta[];
  const cuentasUsadas = await dbComoEmpresa(empresa.id, (tx) => tx.select({ id: cuentasMl.id, nickname: cuentasMl.nickname }).from(cuentasMl));
  const nombrePorCuenta = new Map(cuentasUsadas.map((c) => [c.id, c.nickname]));

  return (
    <main style={{ maxWidth: 560, margin: "0 auto", padding: "48px 24px" }}>
      <h1 style={{ fontSize: 24, fontWeight: 700 }}>{producto.titulo || "(sin título)"}</h1>
      <p style={{ opacity: 0.7, fontSize: 13 }}>{ETIQUETA_ESTADO[producto.estado] ?? producto.estado}</p>

      {resultado.length === 0 && producto.estado === "publicando" && <p style={{ fontSize: 14 }}>Publicando en Mercado Libre, un momento…</p>}

      <ul style={{ listStyle: "none", padding: 0, marginTop: 16 }}>
        {resultado.map((r, i) => (
          <ResultadoCuenta key={i} resultado={r} nickname={nombrePorCuenta.get(r.cuentaMlId) ?? r.cuentaMlId} />
        ))}
      </ul>

      <p style={{ marginTop: 24 }}>
        <Link href="/panel/publicar" style={{ fontSize: 13 }}>
          Volver al historial
        </Link>
      </p>
    </main>
  );
}
