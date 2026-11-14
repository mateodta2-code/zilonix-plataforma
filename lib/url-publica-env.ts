// Sin next/headers a propósito: lo usa también el middleware.
// Dominio único (seller.zilonix.com): si existe APP_URL (o, en su
// defecto, PUBLIC_APP_URL / NEXT_PUBLIC_APP_URL) manda sobre todo lo
// demás; sin ella, todo sigue como antes (RAILWAY_PUBLIC_DOMAIN).
export function urlPublicaDesdeEnv(env: Record<string, string | undefined> = process.env): string | null {
  const cruda = env.APP_URL?.trim() || env.PUBLIC_APP_URL?.trim() || env.NEXT_PUBLIC_APP_URL?.trim();
  if (!cruda) return null;
  const conProtocolo = /^https?:\/\//i.test(cruda) ? cruda : `https://${cruda}`;
  return conProtocolo.replace(/\/+$/, "");
}
