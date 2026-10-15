// Tarea 1.10 — "límite de peticiones por usuario y por IP". Memoria
// en el proceso, a propósito: no hay todavía un Redis ni nada
// compartido entre instancias (Railway corre un solo proceso de `web`
// hoy — la decisión D4 del plan técnico ya marca "revisar al pasar de
// ~500 empresas", que es también cuando esto dejaría de alcanzar con
// un solo proceso). Vive aparte de middleware.ts para poder probarla
// sola, sin tener que levantar Next.js ni Clerk.
export type ContadorVentana = { inicioMs: number; conteo: number };

export function creaContador(): Map<string, ContadorVentana> {
  return new Map();
}

// true = esta clave (una IP o un usuario) ya superó el límite en la
// ventana actual. Ventana fija (no deslizante): más simple, y de
// sobra para frenar un abuso real sin perseguir precisión de milisegundo.
export function superaLimite(
  contador: Map<string, ContadorVentana>,
  clave: string,
  limite: number,
  ventanaMs: number,
  ahoraMs: number = Date.now()
): boolean {
  const actual = contador.get(clave);
  if (!actual || ahoraMs - actual.inicioMs > ventanaMs) {
    contador.set(clave, { inicioMs: ahoraMs, conteo: 1 });
    return false;
  }
  actual.conteo += 1;
  return actual.conteo > limite;
}

// Sin esto, el mapa crece para siempre con cada IP/usuario que pasó
// una sola vez — se llama cada tanto desde middleware.ts, nunca en
// cada petición, para no gastar tiempo de más en el caso normal.
export function limpiarVencidos(contador: Map<string, ContadorVentana>, ventanaMs: number, ahoraMs: number = Date.now()): void {
  for (const [clave, { inicioMs }] of contador) {
    if (ahoraMs - inicioMs > ventanaMs) contador.delete(clave);
  }
}
