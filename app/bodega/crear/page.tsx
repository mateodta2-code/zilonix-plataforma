import { redirect } from "next/navigation";
import { normalizarParametro } from "@/lib/filtros-listado";
import { Boton } from "@/components/marco/Boton";
import { Campo } from "@/components/marco/Campo";
import { Tarjeta } from "@/components/marco/Tarjeta";
import { yaCreoBodegaAutorregistrada, NOMBRE_SEDE_POR_DEFECTO } from "@/lib/bodega/autorregistro";
import { RUTA_LOGIN } from "@/lib/bodega/contexto";
import { obtenerOCrearUsuarioActual } from "@/lib/usuarios";
import styles from "@/app/panel/personas/page.module.css";
import formStyles from "@/app/panel/invitar/page.module.css";
import { crearBodegaAction } from "./actions";

// Crear la bodega propia (requiere sesión; fuera de (panel) a propósito: todavía
// no hay membresía, así que no pasa por accesoBodega). Tener empresa de
// vendedor o perfil de domiciliario no bloquea.
export default async function CrearBodegaPage({ searchParams }: { searchParams: Record<string, string | string[] | undefined> }) {
  const usuario = await obtenerOCrearUsuarioActual();
  if (!usuario) redirect(RUTA_LOGIN.bodega);
  if (await yaCreoBodegaAutorregistrada(usuario.id)) redirect("/bodega");
  const error = normalizarParametro(searchParams.error);

  return (
    <main style={{ maxWidth: 480, margin: "0 auto", padding: "48px 24px" }}>
      <h1 style={{ fontSize: 24, fontWeight: 700 }}>Registra tu bodega</h1>
      <p style={{ opacity: 0.7, fontSize: 14, lineHeight: 1.5 }}>Indica el nombre de tu bodega y su primera sede. Después podrás agregar más sedes desde el panel.</p>
      {error && <p className={styles.avisoError}>{error}</p>}
      <Tarjeta>
        <form action={crearBodegaAction} className={formStyles.form}>
          <Campo etiqueta="Nombre de la bodega">
            <input name="nombre" required minLength={2} maxLength={80} className="zx-control" />
          </Campo>
          <Campo etiqueta="NIT (opcional)">
            <input name="nit" maxLength={40} className="zx-control" />
          </Campo>
          <Campo etiqueta="Nombre de la primera sede">
            <input name="sedeNombre" required minLength={2} maxLength={80} defaultValue={NOMBRE_SEDE_POR_DEFECTO} className="zx-control" />
          </Campo>
          <Campo etiqueta="Dirección de la sede (opcional)">
            <input name="sedeDireccion" maxLength={200} className="zx-control" />
          </Campo>
          <Campo etiqueta="Ciudad (opcional)">
            <input name="sedeCiudad" maxLength={80} className="zx-control" />
          </Campo>
          <Boton type="submit" className={formStyles.botonEnviar}>
            Registrar mi bodega
          </Boton>
        </form>
      </Tarjeta>
    </main>
  );
}
