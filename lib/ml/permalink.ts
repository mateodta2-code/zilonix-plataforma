// Revisión de Pablo (PR #310) — linkPublicacion vivía en lib/ml/cliente.ts,
// que un componente "use client" (TarjetaDespachoCliente.tsx) no debe
// importar nunca: ese archivo es el cliente central de la API de
// Mercado Libre, con fetch/timeouts/errores tipados pensados para
// Server Components y Route Handlers — nada de eso debe terminar en
// el bundle del navegador, aunque hoy no truene. Este módulo no
// importa nada de lib/ml/cliente.ts a propósito (ni siquiera el
// patrón de id): así queda garantizado que un componente de cliente
// que lo importe nunca arrastra ese archivo completo. lib/ml/sitios.ts
// sí es seguro de importar acá — es un mapa puro, sin fetch ni nada
// que no deba ir al bundle del navegador.
import { dominioMl } from "@/lib/ml/sitios";

// Link real de la publicación — confirmado en producción
// (zilonix-os-web): articulo.mercadolibre.com.co/MCO-{numero} redirige
// a la ficha exacta, sin pasar por /items/{id} (que da 403 para
// publicaciones ajenas).
//
// Issue #315 — antes fijaba "MCO"/".com.co" a mano. El propio itemId
// YA trae el site_id real como prefijo (MCO, MLM, MLA...), así que el
// dominio sale de ahí (dominioMl, lib/ml/sitios.ts) — nunca de "la
// cuenta que lo pidió", que puede no estar disponible (ej. este
// módulo lo importa un componente "use client", sin sesión/DB a
// mano).
const PATRON_ID_PRODUCTO_O_ITEM = /^[A-Z]{3}\d+$/;

export function linkPublicacion(itemId: string): string | null {
  if (!PATRON_ID_PRODUCTO_O_ITEM.test(itemId)) return null;
  const siteId = itemId.slice(0, 3);
  return `https://articulo.${dominioMl(siteId)}/${itemId.replace(/^([A-Z]{3})(\d+)$/, "$1-$2")}`;
}
