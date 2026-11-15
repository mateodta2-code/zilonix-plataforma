const PATRON_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

// Bug real en vivo (digest 960283135, staging): Clerk deja /sso-callback
// colgado relativo a la ruta donde estaba la persona cuando inició
// sesión (returnBackUrl del middleware) — bajo una ruta dinámica como
// /panel/pedidos/[id], ese "sso-callback" se cuela como si fuera el id.
// eq(tabla.id, "sso-callback") contra una columna uuid revienta Postgres
// con 22P02 ("invalid input syntax for type uuid") en vez de un 404 o un
// redirect normal — Next.js lo muestra como "Application error". Una
// sola fuente de verdad para el formato, en vez de adivinarlo a mano en
// cada ruta/helper que reciba un id de la URL.
export function esUuid(valor: string): boolean {
  return PATRON_UUID.test(valor);
}
