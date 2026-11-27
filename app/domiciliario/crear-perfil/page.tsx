import { redirect } from "next/navigation";
import { normalizarParametro } from "@/lib/filtros-listado";
import { Boton } from "@/components/marco/Boton";
import { Campo } from "@/components/marco/Campo";
import { Tarjeta } from "@/components/marco/Tarjeta";
import { listarMembresiasDeUsuario } from "@/lib/bodega/miembros";
import { tienePerfilDomiciliario } from "@/lib/bodega/perfil-domiciliario";
import { obtenerOCrearUsuarioActual } from "@/lib/usuarios";
import styles from "@/app/panel/personas/page.module.css";
import formStyles from "@/app/panel/invitar/page.module.css";
import { crearPerfilDomiciliarioAction } from "./actions";

export const dynamic = "force-dynamic";

// Segundo paso del autorregistro. Tener empresa de vendedor o ser admin u
// operario de una bodega NO bloquea: solo se redirige si ya tiene perfil o
// ya es domiciliario activo de alguna bodega.
export default async function CrearPerfilDomiciliarioPage({ searchParams }: { searchParams: { error?: string } }) {
  const usuario = await obtenerOCrearUsuarioActual();
  if (!usuario) redirect("/domiciliario/iniciar-sesion");

  const [membresias, tienePerfil] = await Promise.all([listarMembresiasDeUsuario(usuario.id), tienePerfilDomiciliario(usuario.id)]);
  if (tienePerfil || membresias.some((m) => m.rol === "domiciliario" && m.activo)) redirect("/domiciliario");

  const error = normalizarParametro(searchParams.error);
  return (
    <main style={{ maxWidth: 480, margin: "0 auto", padding: "48px 24px" }}>
      <h1 style={{ fontSize: 24, fontWeight: 700 }}>Crea tu perfil de domiciliario</h1>
      <p style={{ opacity: 0.7, fontSize: 14, lineHeight: 1.5 }}>
        Con este perfil las bodegas podrán invitarte con tu correo ({usuario.email}). Solo el nombre es obligatorio.
      </p>
      {error && <p className={styles.avisoError}>{error}</p>}
      <Tarjeta>
        <form action={crearPerfilDomiciliarioAction} className={formStyles.form}>
          <Campo etiqueta="Nombre">
            <input name="nombre" required maxLength={120} defaultValue={usuario.nombre} className="zx-control" />
          </Campo>
          <Campo etiqueta="Teléfono (opcional)">
            <input name="telefono" type="tel" maxLength={30} className="zx-control" />
          </Campo>
          <Campo etiqueta="Ciudad (opcional)">
            <input name="ciudad" maxLength={80} className="zx-control" />
          </Campo>
          <Boton type="submit" className={formStyles.botonEnviar}>
            Crear perfil
          </Boton>
        </form>
      </Tarjeta>
    </main>
  );
}
