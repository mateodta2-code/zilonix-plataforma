import { BotonCerrarSesion } from "@/components/marco/BotonCerrarSesion";
import { SinAcceso } from "@/components/marco/SinAcceso";
import { MENSAJE_SIN_ACCESO, type MotivoSinAcceso } from "@/lib/bodega/acceso";

// Sin la membresía correcta (o con la bodega suspendida): la página
// SinAcceso del marco, con cerrar sesión — nunca el panel del vendedor.
export function SinAccesoBodega({ motivo, volverHref = "/", volverTexto = "Ir al inicio" }: { motivo: MotivoSinAcceso; volverHref?: string; volverTexto?: string }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 16, padding: "48px 16px" }}>
      <SinAcceso mensaje={MENSAJE_SIN_ACCESO[motivo]} volverHref={volverHref} volverTexto={volverTexto} />
      <BotonCerrarSesion variante="cuenta" />
    </div>
  );
}
