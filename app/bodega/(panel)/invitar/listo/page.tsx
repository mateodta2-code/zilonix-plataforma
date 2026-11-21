import { BotonLink } from "@/components/marco/Boton";
import { EncabezadoPagina } from "@/components/marco/EncabezadoPagina";
import { SinAccesoBodega } from "@/components/bodega/SinAccesoBodega";
import { accesoBodega } from "@/lib/bodega/contexto";
import { urlPublicaBase } from "@/lib/url-publica";
import styles from "@/app/panel/invitar/listo/page.module.css";

// Todavía no hay proveedor de correo: el link se muestra para que el
// admin lo comparta él mismo (igual que /panel/invitar/listo).
export default async function BodegaInvitacionListaPage({ searchParams }: { searchParams: { token?: string } }) {
  const { decision } = await accesoBodega("bodega", { soloAdmin: true });
  if (!decision.ok) return <SinAccesoBodega motivo={decision.motivo} volverHref="/bodega" volverTexto="Volver a la bodega" />;
  const token = searchParams.token ?? "";
  const link = token ? `${urlPublicaBase()}/invitacion-bodega/${token}` : null;

  return (
    <>
      <EncabezadoPagina titulo="Invitación generada" descripcion="Comparte este link con la persona — solo funciona una vez y vence en 7 días." />
      {link ? <input readOnly value={link} className={`zx-control ${styles.link}`} /> : <p>No se encontró el token.</p>}
      <BotonLink href="/bodega/personas" variante="fantasma" className={styles.volver}>
        Ver personas
      </BotonLink>
    </>
  );
}
