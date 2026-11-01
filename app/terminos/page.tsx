import PaginaLegal from "@/components/portada/PaginaLegal";

// Tarea feat-portada-pagina-venta — página pública, sin texto real
// todavía (ver lib/rutas-publicas.ts para la lista de rutas públicas y
// scripts/verificar-permisos.test.ts para por qué está exenta de
// requierePermiso).
export default function TerminosPage() {
  return <PaginaLegal titulo="Términos" />;
}
