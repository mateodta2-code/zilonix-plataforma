import Link from "next/link";
import { BotonCerrarSesion } from "@/components/marco/BotonCerrarSesion";
import { SinAcceso } from "@/components/marco/SinAcceso";
import { MENSAJE_SIN_ACCESO, type MotivoSinAcceso } from "@/lib/bodega/acceso";
import type { Panel } from "@/lib/bodega/roles";

// Sin la membresía correcta (o con la bodega suspendida): la página
// SinAcceso del marco, con cerrar sesión — nunca el panel del vendedor.
export function SinAccesoBodega({
  motivo,
  panel,
  volverHref = "/",
  volverTexto = "Ir al inicio",
}: {
  motivo: MotivoSinAcceso;
  panel?: Panel;
  volverHref?: string;
  volverTexto?: string;
}) {
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 16, padding: "48px 16px" }}>
      <SinAcceso mensaje={MENSAJE_SIN_ACCESO[motivo]} volverHref={volverHref} volverTexto={volverTexto} />
      {motivo === "sin-membresia" && panel === "bodega" && <Link href="/bodega/crear">Registrar mi bodega</Link>}
      <BotonCerrarSesion variante="cuenta" />
    </div>
  );
}
