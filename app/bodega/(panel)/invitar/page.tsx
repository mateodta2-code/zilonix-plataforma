import { Boton } from "@/components/marco/Boton";
import { Campo } from "@/components/marco/Campo";
import { EncabezadoPagina } from "@/components/marco/EncabezadoPagina";
import { Tarjeta } from "@/components/marco/Tarjeta";
import { SinAccesoBodega } from "@/components/bodega/SinAccesoBodega";
import { accesoBodega } from "@/lib/bodega/contexto";
import { NOMBRE_ROL_BODEGA, ROLES_INVITABLES_POR_ADMIN } from "@/lib/bodega/roles";
import styles from "@/app/panel/invitar/page.module.css";
import { crearInvitacionBodegaAction } from "./actions";

export default async function BodegaInvitarPage() {
  const { decision } = await accesoBodega("bodega", { soloAdmin: true });
  if (!decision.ok) return <SinAccesoBodega motivo={decision.motivo} volverHref="/bodega" volverTexto="Volver a la bodega" />;

  return (
    <>
      <EncabezadoPagina
        titulo={`Invitar a ${decision.membresia.bodegaNombre}`}
        descripcion="Se genera un link de un solo uso que vence en 7 días — nunca se comparte una contraseña."
      />
      <Tarjeta>
        <form action={crearInvitacionBodegaAction} className={styles.form}>
          <Campo etiqueta="Correo de la persona">
            <input type="email" name="email" required className="zx-control" />
          </Campo>
          <Campo etiqueta="Rol">
            <select name="rol" required className="zx-control">
              {ROLES_INVITABLES_POR_ADMIN.map((r) => (
                <option key={r} value={r}>
                  {NOMBRE_ROL_BODEGA[r]}
                </option>
              ))}
            </select>
          </Campo>
          <Boton type="submit" className={styles.botonEnviar}>
            Generar invitación
          </Boton>
        </form>
      </Tarjeta>
    </>
  );
}
