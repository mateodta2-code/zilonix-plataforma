import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { listarEmpresasDeUsuario } from "@/lib/empresas";
import { obtenerMiMembresia } from "@/lib/membresias";
import { obtenerOCrearUsuarioActual } from "@/lib/usuarios";
import { requierePermiso, SinPermisoError } from "@/lib/permisos";
import { listarCuentasConectadas } from "@/lib/ml/cuentas";
import { Boton, BotonLink } from "@/components/marco/Boton";
import { Chip } from "@/components/marco/Chip";
import { EncabezadoPagina } from "@/components/marco/EncabezadoPagina";
import { SinAcceso } from "@/components/marco/SinAcceso";
import { Tarjeta } from "@/components/marco/Tarjeta";
import styles from "./page.module.css";

// Portada de "Conectar marketplaces": una tarjeta por plataforma. Mismo
// permiso que /panel/conectar-ml (configuracion · consultar). Mercado
// Libre lleva a la pantalla de siempre; Falabella y Amazon aún no tienen
// su tarjeta activa.
export default async function ConectarMarketplacesPage() {
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
      <>
        <EncabezadoPagina titulo="Conectar marketplaces" />
        <SinAcceso mensaje={`Tu rol (${miMembresia?.rolNombre ?? "sin rol"}) no tiene acceso a esta pantalla.`} />
      </>
    );
  }

  const cuentas = (await listarCuentasConectadas(empresa.id)).filter((c) => !c.desconectadaTs);
  const textoMl =
    cuentas.length === 0 ? "Sin cuentas conectadas" : cuentas.length === 1 ? "1 cuenta conectada" : `${cuentas.length} cuentas conectadas`;

  return (
    <>
      <EncabezadoPagina titulo="Conectar marketplaces" descripcion="Elige la plataforma que quieres conectar o gestionar." />
      <div className={styles.rejilla}>
        <Tarjeta className={styles.tarjeta}>
          <h2 className={styles.nombre}>Mercado Libre</h2>
          <p className={styles.estado}>{textoMl}</p>
          <BotonLink href="/panel/conectar-ml" variante="primario">
            Gestionar cuentas
          </BotonLink>
        </Tarjeta>
        <Tarjeta className={styles.tarjeta}>
          <h2 className={styles.nombre}>Falabella</h2>
          <p className={styles.estado}>
            <Chip>Próximamente</Chip>
          </p>
          <Boton variante="secundario" disabled>
            Próximamente
          </Boton>
        </Tarjeta>
        <Tarjeta className={styles.tarjeta}>
          <h2 className={styles.nombre}>Amazon</h2>
          <p className={styles.estado}>
            <Chip>Próximamente</Chip>
          </p>
          <Boton variante="secundario" disabled>
            Próximamente
          </Boton>
        </Tarjeta>
      </div>
    </>
  );
}
