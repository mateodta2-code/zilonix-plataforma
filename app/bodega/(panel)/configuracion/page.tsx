import { normalizarParametro } from "@/lib/filtros-listado";
import { Boton } from "@/components/marco/Boton";
import { Campo } from "@/components/marco/Campo";
import { EncabezadoPagina } from "@/components/marco/EncabezadoPagina";
import { Tarjeta } from "@/components/marco/Tarjeta";
import { SinAccesoBodega } from "@/components/bodega/SinAccesoBodega";
import { accesoBodega } from "@/lib/bodega/contexto";
import styles from "@/app/panel/personas/page.module.css";
import formStyles from "@/app/panel/invitar/page.module.css";
import { guardarDatosBodegaAction } from "./actions";

// Nombre y NIT de la bodega — los edita solo admin_bodega.
export default async function BodegaConfiguracionPage({ searchParams }: { searchParams: Record<string, string | string[] | undefined> }) {
  const { decision } = await accesoBodega("bodega", { soloAdmin: true });
  if (!decision.ok) return <SinAccesoBodega motivo={decision.motivo} volverHref="/bodega" volverTexto="Volver a la bodega" />;
  const { bodegaNombre, bodegaNit } = decision.membresia;
  const error = normalizarParametro(searchParams.error);
  const ok = normalizarParametro(searchParams.ok);

  return (
    <>
      <EncabezadoPagina titulo="Configuración" descripcion="Datos de la bodega." />
      {error && <p className={styles.avisoError}>{error}</p>}
      {ok && <p className={styles.avisoExito}>{ok}</p>}
      <Tarjeta>
        <form action={guardarDatosBodegaAction} className={formStyles.form}>
          <Campo etiqueta="Nombre de la bodega">
            <input name="nombre" required maxLength={120} defaultValue={bodegaNombre} className="zx-control" />
          </Campo>
          <Campo etiqueta="NIT (opcional)">
            <input name="nit" maxLength={40} defaultValue={bodegaNit ?? ""} className="zx-control" />
          </Campo>
          <Boton type="submit" className={formStyles.botonEnviar}>
            Guardar
          </Boton>
        </form>
      </Tarjeta>
    </>
  );
}
