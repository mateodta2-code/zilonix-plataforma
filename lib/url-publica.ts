import { headers } from "next/headers";

// Tarea 1.12 — bug real encontrado en vivo en staging: la cabecera
// "host" que llega a Next.js detrás del proxy de Railway resultó ser
// "localhost" (el proxy no la pasa igual que el dominio público real),
// así que un link armado con headers().get("host") salía inválido.
// RAILWAY_PUBLIC_DOMAIN es una variable que Railway ya inyecta sola con
// el dominio público real — no depende de cómo el proxy arme esa
// cabecera. x-forwarded-host/-proto quedan de respaldo solo para
// correr local (`npm run dev`), donde esa variable no existe. Extraído
// a un helper aparte en la tarea 2.3, al necesitarlo por segunda vez
// (la ruta de callback de Mercado Libre tiene que registrar exactamente
// la misma URL que esta función arma).
export function urlPublicaBase(): string {
  const encabezados = headers();
  const dominio = process.env.RAILWAY_PUBLIC_DOMAIN ?? encabezados.get("x-forwarded-host") ?? encabezados.get("host");
  const proto = process.env.RAILWAY_PUBLIC_DOMAIN ? "https" : encabezados.get("x-forwarded-proto") ?? "http";
  return `${proto}://${dominio}`;
}
