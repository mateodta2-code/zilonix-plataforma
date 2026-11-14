// Sin next/headers a propósito: lo usa también el middleware.
// Dominio único (seller.zilonix.com): si existe APP_URL (o, en su
// defecto, PUBLIC_APP_URL / NEXT_PUBLIC_APP_URL) válida, manda sobre
// todo lo demás; sin ella, todo sigue como antes (RAILWAY_PUBLIC_DOMAIN).
//
// Una variable es válida solo si se parsea con new URL(), usa https:,
// no trae usuario/contraseña y se devuelve únicamente el origen (sin
// path, query ni barra final). Si no lo es, se ignora.
function origenHttpsValido(cruda: string | undefined): string | null {
  const valor = cruda?.trim();
  if (!valor) return null;
  const conEsquema = /^[a-z][a-z0-9+.-]*:\/\//i.test(valor) ? valor : `https://${valor}`;
  try {
    const url = new URL(conEsquema);
    if (url.protocol !== "https:") return null;
    if (url.username || url.password) return null;
    return url.origin;
  } catch {
    return null;
  }
}

export function urlPublicaDesdeEnv(env: Record<string, string | undefined> = process.env): string | null {
  for (const cruda of [env.APP_URL, env.PUBLIC_APP_URL, env.NEXT_PUBLIC_APP_URL]) {
    const origen = origenHttpsValido(cruda);
    if (origen) return origen;
  }
  return null;
}
