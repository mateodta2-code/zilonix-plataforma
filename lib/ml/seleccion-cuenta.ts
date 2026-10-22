// Issue #54 (Z-MT-08) — selector de cuenta de Mercado Libre compartido
// entre pantallas (bandeja, publicar, inventario, despachos — cada una
// lo adopta en su propio issue, ver CLAUDE.md "una tarea por sesión").
//
// Función pura para que ninguna pantalla tenga que reinventar esta
// regla: si el ?cuenta= de la URL no es una cuenta real de la empresa
// activa (vieja, de otra empresa, o un valor cualquiera escrito a
// mano), se trata exactamente igual que si no hubiera query — nunca se
// confía en el valor de la URL sin cruzarlo contra la lista real.
export const CUENTA_TODAS = "todas" as const;

export type CuentaMlOpcion = { id: string; apodo: string };

export function resolverCuentaSeleccionada(
  queryCuenta: string | null | undefined,
  cuentasPermitidas: CuentaMlOpcion[]
): string | typeof CUENTA_TODAS {
  if (!queryCuenta) return CUENTA_TODAS;
  const esDeLaEmpresa = cuentasPermitidas.some((c) => c.id === queryCuenta);
  return esDeLaEmpresa ? queryCuenta : CUENTA_TODAS;
}
