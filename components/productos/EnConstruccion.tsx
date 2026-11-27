import { Tarjeta } from "@/components/marco/Tarjeta";

// Issue #280 — tarjeta de los submódulos de Productos que todavía no
// tienen contenido (Devoluciones, Inventario Full, Proyección). Usa la
// Tarjeta de marca: borde, fondo y temas claro/oscuro ya resueltos.
export function EnConstruccion({ children }: { children?: React.ReactNode }) {
  return (
    <Tarjeta>
      <p>Este módulo está en construcción. Pronto vas a poder trabajar aquí.</p>
      {children && <p>{children}</p>}
    </Tarjeta>
  );
}
