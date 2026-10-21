import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import Link from "next/link";
import { listarEmpresasDeUsuario } from "@/lib/empresas";
import { obtenerMiMembresia } from "@/lib/membresias";
import { obtenerOCrearUsuarioActual } from "@/lib/usuarios";
import { requierePermiso, SinPermisoError } from "@/lib/permisos";
import { listarCuentasConectadas } from "@/lib/ml/cuentas";

// Tarea 2.3 — "Conectar ML en 1 clic". Regla de UX #1 del plan técnico
// ("si el canal no está habilitado para ese plan/cuenta, avisarlo ANTES
// de mandar a la pantalla de autorización de ML", evidencia real contra
// Multivende): honestidad del alcance — todavía no existe ningún
// sistema de planes en Zilonix (llega en la Fase 4, "piloto pagado"),
// así que hoy no hay nada real que esta pantalla pueda chequear antes
// de redirigir. El día que exista un plan con canales habilitados/
// deshabilitados, ese chequeo se agrega acá mismo, antes de construir
// el link de abajo — no se inventa un candado falso hoy solo para
// simular que la regla ya está resuelta.
export default async function ConectarMlPage({ searchParams }: { searchParams: { conectado?: string; error?: string } }) {
  const usuario = await obtenerOCrearUsuarioActual();
  if (!usuario) redirect("/sign-in");

  const propias = await listarEmpresasDeUsuario(usuario.id);
  const empresaId = cookies().get("empresa_actual")?.value;
  const empresa = propias.find((e) => e.id === empresaId) ?? propias[0];
  if (!empresa) redirect("/crear-empresa");

  try {
    await requierePermiso(usuario.id, empresa.id, "configuracion", "consultar");
  } catch (error) {
    if (!(error instanceof SinPermisoError)) throw error;
    const miMembresia = await obtenerMiMembresia(usuario.id, empresa.id);
    return (
      <main style={{ maxWidth: 480, margin: "0 auto", padding: "48px 24px" }}>
        <h1 style={{ fontSize: 20, fontWeight: 700 }}>Conectar Mercado Libre</h1>
        <p style={{ opacity: 0.7, fontSize: 14 }}>
          Tu rol ({miMembresia?.rolNombre ?? "sin rol"}) no tiene acceso a esta pantalla.
        </p>
        <Link href="/panel">Volver al panel</Link>
      </main>
    );
  }

  const cuentas = await listarCuentasConectadas(empresa.id);
  // Bug real (PKCE): el link de autorización ya no se arma acá — cada
  // intento necesita un code_verifier NUEVO (de un solo uso), así que
  // /api/ml/conectar lo genera recién al hacer clic, no de antemano en
  // esta misma carga de la página.
  const urlConectar = "/api/ml/conectar";

  return (
    <main style={{ maxWidth: 480, margin: "0 auto", padding: "48px 24px" }}>
      <h1 style={{ fontSize: 24, fontWeight: 700 }}>Conectar Mercado Libre</h1>

      {searchParams.conectado && (
        <p style={{ padding: 10, background: "#e6f4ea", borderRadius: 6, fontSize: 14 }}>Cuenta conectada.</p>
      )}
      {searchParams.error && (
        // Regla de UX #2 del plan técnico (evidencia real contra
        // Multivende: si el canje del code por el token falla, se
        // queda en spinner infinito, sin ningún mensaje) — acá se ve
        // el error real y un botón para reintentar, nunca un
        // silencio.
        <div style={{ padding: 10, background: "#fdecea", borderRadius: 6, fontSize: 14 }}>
          <p style={{ margin: 0 }}>No se pudo conectar la cuenta: {searchParams.error}</p>
          <a href={urlConectar} style={{ fontSize: 13, fontWeight: 600 }}>
            Reintentar
          </a>
        </div>
      )}

      {cuentas.length > 0 && (
        <ul style={{ listStyle: "none", padding: 0, marginTop: 20 }}>
          {cuentas.map((cuenta) => (
            <li
              key={cuenta.id}
              style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "10px 0", borderBottom: "1px solid #eee" }}
            >
              <span>
                Conectado como <strong>{cuenta.nickname}</strong>
                {cuenta.desconectadaTs && <span style={{ opacity: 0.6 }}> (desconectada)</span>}
              </span>
              {!cuenta.desconectadaTs && (
                <Link href={`/panel/conectar-ml/${cuenta.id}/desconectar`} style={{ fontSize: 13, opacity: 0.7 }}>
                  Desconectar
                </Link>
              )}
            </li>
          ))}
        </ul>
      )}

      <a
        href={urlConectar}
        style={{ display: "inline-block", marginTop: 20, padding: "10px 16px", background: "#000", color: "#fff", borderRadius: 6, fontSize: 14, textDecoration: "none" }}
      >
        Conectar Mercado Libre
      </a>

      <p style={{ marginTop: 24 }}>
        <Link href="/panel" style={{ fontSize: 13 }}>
          Volver al panel
        </Link>
      </p>
    </main>
  );
}
