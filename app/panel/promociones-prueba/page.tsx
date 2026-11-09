import { redirect } from "next/navigation";
import { obtenerOCrearUsuarioActual } from "@/lib/usuarios";
import { EncabezadoPagina } from "@/components/marco/EncabezadoPagina";
import { PaginaPromocionesPrueba } from "./PaginaPromocionesPrueba";

// Rama mateo/promociones-visual-prueba — maqueta aislada del rediseño
// de Promociones, para que Débora la revise antes de tocar el módulo
// real (app/panel/promociones/). Solo resuelve sesión (como
// app/panel/mis-datos/page.tsx): no hay empresa activa que resolver ni
// permiso de módulo que pedir porque la página entera es datos fijos
// en memoria, nunca una tabla real — ver el motivo exacto en
// scripts/verificar-permisos.test.ts (RUTAS_EXENTAS).
export default async function PromocionesPruebaPage() {
  const usuario = await obtenerOCrearUsuarioActual();
  if (!usuario) redirect("/sign-in");

  return (
    <>
      <EncabezadoPagina titulo="Promociones — maqueta" descripcion="Vista de prueba del rediseño, con datos de ejemplo fijos. No participa en nada real." />
      <PaginaPromocionesPrueba />
    </>
  );
}
