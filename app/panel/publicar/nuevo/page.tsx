import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import Link from "next/link";
import { listarEmpresasDeUsuario } from "@/lib/empresas";
import { obtenerMiMembresia } from "@/lib/membresias";
import { obtenerOCrearUsuarioActual } from "@/lib/usuarios";
import { requierePermiso, SinPermisoError } from "@/lib/permisos";
import { listarCuentasConectadas } from "@/lib/ml/cuentas";
import { linkHttpSeguro } from "@/lib/ml/listadoCliente";
import { FormularioPublicar } from "./FormularioPublicar";

// Tarea 2.11 ("Publicar producto y clip") + ADENDO UX de Publicar — la
// fidelidad del 100% sigue en la LÓGICA de negocio (lib/ml/publicar.ts,
// lib/ml/publicar-reglas.ts, sin cambios de este adendo); esta página
// ahora delega el formulario interactivo (categoría dinámica,
// atributos, editor de variantes) a FormularioPublicar.tsx ("use
// client") — acá solo queda la resolución de sesión/empresa/permiso y
// el prefill que llega desde Investigación (punto 8 del ADENDO).
export default async function PublicarNuevoPage({ searchParams }: { searchParams: { titulo?: string; precio?: string; foto?: string } }) {
  const usuario = await obtenerOCrearUsuarioActual();
  if (!usuario) redirect("/sign-in");

  const propias = await listarEmpresasDeUsuario(usuario.id);
  const empresaId = cookies().get("empresa_actual")?.value;
  const empresa = propias.find((e) => e.id === empresaId) ?? propias[0];
  if (!empresa) redirect("/crear-empresa");

  try {
    await requierePermiso(usuario.id, empresa.id, "inventario", "crear");
  } catch (error) {
    if (!(error instanceof SinPermisoError)) throw error;
    const miMembresia = await obtenerMiMembresia(usuario.id, empresa.id);
    return (
      <main style={{ maxWidth: 480, margin: "0 auto", padding: "48px 24px" }}>
        <p>Tu rol ({miMembresia?.rolNombre ?? "sin rol"}) no tiene acceso a esta pantalla.</p>
        <Link href="/panel/publicar">Volver</Link>
      </main>
    );
  }

  const cuentas = (await listarCuentasConectadas(empresa.id)).filter((c) => !c.desconectadaTs);

  if (cuentas.length === 0) {
    return (
      <main style={{ maxWidth: 480, margin: "0 auto", padding: "48px 24px" }}>
        <p>Todavía no hay ninguna cuenta de Mercado Libre conectada.</p>
        <Link href="/panel/conectar-ml">Conectar una cuenta</Link>
      </main>
    );
  }

  // ADENDO UX de Publicar, punto 8 — "prefill seguro (título, etc.)":
  // título/precio son texto plano (van directo a un <input> de React,
  // nunca a innerHTML — sin riesgo de XSS); la foto SÍ se sanea con
  // linkHttpSeguro (mismo helper que ya usa PanelInvestigacion.tsx
  // para cualquier link externo) antes de usarla como valor inicial.
  const prefill = {
    titulo: (searchParams.titulo ?? "").slice(0, 60),
    precio: searchParams.precio && Number.isFinite(Number(searchParams.precio)) ? searchParams.precio : "",
    foto: linkHttpSeguro(searchParams.foto ?? null) ?? "",
  };

  return (
    <main style={{ maxWidth: 640, margin: "0 auto", padding: "48px 24px" }}>
      <h1 style={{ fontSize: 24, fontWeight: 700 }}>Publicar producto nuevo</h1>
      <FormularioPublicar cuentas={cuentas.map((c) => ({ id: c.id, nickname: c.nickname }))} prefill={prefill} />
    </main>
  );
}
