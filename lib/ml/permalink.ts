// Revisión de Pablo (PR #310) — linkPublicacion vivía en lib/ml/cliente.ts,
// que un componente "use client" (TarjetaDespachoCliente.tsx) no debe
// importar nunca: ese archivo es el cliente central de la API de
// Mercado Libre, con fetch/timeouts/errores tipados pensados para
// Server Components y Route Handlers — nada de eso debe terminar en
// el bundle del navegador, aunque hoy no truene. Este módulo no
// importa nada de lib/ml/cliente.ts a propósito (ni siquiera el
// patrón de id): así queda garantizado que un componente de cliente
// que lo importe nunca arrastra ese archivo completo.
//
// Link real de la publicación — confirmado en producción
// (zilonix-os-web): articulo.mercadolibre.com.co/MCO-{numero} redirige
// a la ficha exacta, sin pasar por /items/{id} (que da 403 para
// publicaciones ajenas).
const PATRON_ID_PRODUCTO_O_ITEM = /^MCO\d+$/;

export function linkPublicacion(itemId: string): string | null {
  if (!PATRON_ID_PRODUCTO_O_ITEM.test(itemId)) return null;
  return `https://articulo.mercadolibre.com.co/${itemId.replace(/^MCO(\d+)$/, "MCO-$1")}`;
}
