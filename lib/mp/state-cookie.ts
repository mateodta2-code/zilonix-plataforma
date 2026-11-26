// Cookie httpOnly del `state` de OAuth que viaja entre /api/mp/conectar
// (la genera) y /api/mp/callback (la compara y la borra) — aparte en su
// propio archivo (no en un route.ts) porque un archivo de ruta de
// Next.js solo debe exportar los métodos HTTP. Mismo patrón que
// lib/ml/pkce-cookie.ts y lib/canva/pkce-cookie.ts.
export const NOMBRE_COOKIE_STATE = "mp_oauth_state";

// Path acotado a /api/mp: el navegador solo la manda a estas rutas. Para
// borrarla hay que usar el MISMO path (ver /api/mp/callback).
export const PATH_COOKIE_STATE = "/api/mp";

export const OPCIONES_COOKIE_STATE = {
  httpOnly: true,
  secure: true,
  sameSite: "lax" as const,
  maxAge: 600, // 10 minutos — de sobra para autorizar en Mercado Pago
  path: PATH_COOKIE_STATE,
};
