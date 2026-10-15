import { cookies } from "next/headers";
import Link from "next/link";
import { redirect } from "next/navigation";
import { listarEmpresasDeUsuario } from "@/lib/empresas";
import { obtenerMiMembresia } from "@/lib/membresias";
import { obtenerOCrearUsuarioActual } from "@/lib/usuarios";
import { MODULOS, tienePermiso } from "@/lib/roles";
import { cambiarEmpresaActiva } from "./actions";

// Tarea 1.6 — pantalla mínima que prueba el criterio de "listo": con un
// usuario en 2 empresas, al cambiar ves datos distintos (acá, el nombre
// y el NIT de la empresa activa) y nunca mezclados. Las pantallas de
// negocio de verdad (ventas, inventario) llegan en la Fase 2.
//
// Tarea 1.7 — los módulos del nav se filtran por lo que el rol de esta
// persona puede consultar (ej. el Operador no ve "finanzas"). Solo
// "finanzas" tiene una pantalla real detrás (app/panel/finanzas) para
// poder probar esto de verdad; el resto es a propósito un link que
// todavía no lleva a ningún lado (llegan en Fases 2 y 3).
export default async function PanelPage() {
  const usuario = await obtenerOCrearUsuarioActual();
  if (!usuario) redirect("/sign-in");

  const propias = await listarEmpresasDeUsuario(usuario.id);
  if (propias.length === 0) redirect("/crear-empresa");

  const cookieEmpresa = cookies().get("empresa_actual")?.value;
  const activa = propias.find((e) => e.id === cookieEmpresa) ?? propias[0];
  const miMembresia = await obtenerMiMembresia(usuario.id, activa.id);
  const modulosVisibles = miMembresia
    ? MODULOS.filter((modulo) => tienePermiso(miMembresia.permisos, modulo, "consultar"))
    : [];

  return (
    <main style={{ maxWidth: 560, margin: "0 auto", padding: "48px 24px" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12 }}>
        <div>
          <h1 style={{ fontSize: 24, fontWeight: 700, margin: 0 }}>{activa.nombre}</h1>
          <p style={{ opacity: 0.6, fontSize: 13, margin: "4px 0 0 0" }}>
            NIT {activa.nit} · {miMembresia?.rolNombre ?? "sin rol"}
          </p>
        </div>
        <Link href="/cuenta" style={{ fontSize: 13 }}>
          Mi cuenta
        </Link>
      </div>

      {modulosVisibles.length > 0 && (
        <nav style={{ display: "flex", gap: 10, marginTop: 20, flexWrap: "wrap" }}>
          {modulosVisibles.map((modulo) =>
            modulo === "finanzas" ? (
              <Link
                key={modulo}
                href="/panel/finanzas"
                style={{ padding: "6px 12px", border: "1px solid currentColor", borderRadius: 6, fontSize: 13, textTransform: "capitalize" }}
              >
                {modulo}
              </Link>
            ) : (
              <span
                key={modulo}
                title="Llega en una fase siguiente del plan técnico"
                style={{ padding: "6px 12px", border: "1px dashed currentColor", borderRadius: 6, fontSize: 13, opacity: 0.5, textTransform: "capitalize" }}
              >
                {modulo}
              </span>
            )
          )}
        </nav>
      )}

      {propias.length > 1 && (
        <form action={cambiarEmpresaActiva} style={{ marginTop: 28 }}>
          <label htmlFor="empresaId" style={{ fontSize: 13, opacity: 0.7 }}>
            Cambiar de empresa
          </label>
          <div style={{ display: "flex", gap: 8, marginTop: 4 }}>
            <select id="empresaId" name="empresaId" defaultValue={activa.id} style={{ flex: 1, padding: 8 }}>
              {propias.map((e) => (
                <option key={e.id} value={e.id}>
                  {e.nombre}
                </option>
              ))}
            </select>
            <button type="submit" style={{ padding: "8px 16px" }}>
              Cambiar
            </button>
          </div>
        </form>
      )}

      {miMembresia?.rolNombre === "Dueño" && (
        <div style={{ display: "flex", gap: 16, marginTop: 28, fontSize: 13 }}>
          <Link href="/panel/invitar">+ Invitar persona</Link>
          <Link href="/panel/roles">Ajustar roles</Link>
        </div>
      )}

      <Link href="/crear-empresa" style={{ display: "inline-block", marginTop: 16, fontSize: 13 }}>
        + Crear otra empresa
      </Link>
    </main>
  );
}
