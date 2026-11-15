import { redirect } from "next/navigation";
import { obtenerOCrearUsuarioActual } from "@/lib/usuarios";
import { EncabezadoPagina } from "@/components/marco/EncabezadoPagina";
import { PaginaMisDatos } from "./PaginaMisDatos";

// Issue #318 (Ley 1581 de 2012) — a diferencia del resto de /panel,
// esta página no resuelve ninguna empresa activa: exportar/borrar los
// datos propios es GLOBAL (abarca TODAS las empresas donde la persona
// tiene membresía, decisión de Mateo), no una acción de la empresa que
// esté activa en la cookie en este momento.
export default async function MisDatosPage() {
  const usuario = await obtenerOCrearUsuarioActual();
  if (!usuario) redirect("/sign-in");

  return (
    <>
      <EncabezadoPagina
        titulo="Mis datos personales"
        descripcion="Exporta todo lo que Zilonix guarda sobre tu cuenta, o pide borrarla — Ley 1581 de 2012. Nunca incluye tokens ni claves de ninguna cuenta de Mercado Libre."
      />
      <PaginaMisDatos nombre={usuario.nombre} />
    </>
  );
}
