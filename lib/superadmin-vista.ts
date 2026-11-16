// Helpers puros de presentación del panel superadmin (sin base ni Next),
// para probarlos solos.
import type { EmpresaConConteo } from "@/lib/superadmin";

// "maria@dominio.co" → "m***@dominio.co". Sin "@" válido no se muestra nada útil.
export function enmascararCorreo(correo: string): string {
  const arroba = correo.lastIndexOf("@");
  if (arroba < 1) return "***";
  return `${correo.slice(0, 1)}***${correo.slice(arroba)}`;
}

export type ResumenGlobal = {
  empresasActivas: number;
  empresasSuspendidas: number;
  miembros: number;
  cuentasMl: number;
  cuentasFalabella: number;
};

// Solo sumas de lo que ya devuelve listarEmpresasConConteo(): nunca
// productos, pedidos ni compradores.
export function resumenGlobal(empresas: Pick<EmpresaConConteo, "estado" | "miembros" | "cuentasMl" | "cuentasFalabella">[]): ResumenGlobal {
  const r: ResumenGlobal = { empresasActivas: 0, empresasSuspendidas: 0, miembros: 0, cuentasMl: 0, cuentasFalabella: 0 };
  for (const e of empresas) {
    if (e.estado === "suspendida") r.empresasSuspendidas++;
    else r.empresasActivas++;
    r.miembros += e.miembros;
    r.cuentasMl += e.cuentasMl;
    r.cuentasFalabella += e.cuentasFalabella;
  }
  return r;
}
