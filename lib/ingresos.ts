import { sql } from "drizzle-orm";
import { dbComoEmpresa } from "@/db/empresa-context";

// Empresas inactivas (25-nov): anota que alguien de la empresa abrió /panel.
// La base decide si escribe (como mucho una vez por hora, y solo en la
// empresa de la sesión — registrar_ingreso_empresa() en db/rls-setup.sql).
// Nunca rompe el panel: si falla, solo queda en el log.
export async function registrarIngresoEmpresa(empresaId: string): Promise<void> {
  try {
    await dbComoEmpresa(empresaId, (tx) => tx.execute(sql`select registrar_ingreso_empresa()`));
  } catch (error) {
    console.error("[lib/ingresos] no se pudo anotar el ingreso:", error instanceof Error ? error.name : error);
  }
}
