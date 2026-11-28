import { redirect } from "next/navigation";

// «Resumen» de Finanzas se retiró (pedido de Sharel, 2026-11-28): sus
// tarjetas (ventas, recaudo, utilidad del mes) ya salen en Inicio, con
// los mismos textos de components/finanzas/textosTablero.ts. La ruta
// queda solo como redirect a Ventas y utilidad para no romper un link
// viejo (bookmark, el «Volver a Finanzas» de cada pantalla, el menú
// contraído). Nunca lee ni escribe nada — por eso está en RUTAS_EXENTAS
// (scripts/verificar-permisos.test.ts); el permiso real se revisa en
// /panel/finanzas/ventas.
export default function FinanzasPage() {
  redirect("/panel/finanzas/ventas");
}
