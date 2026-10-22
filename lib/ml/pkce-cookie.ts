// Nombres de las cookies httpOnly que viajan entre /api/ml/conectar
// (las genera) y /api/ml/callback (las usa y las borra) — aparte en su
// propio archivo (no en un route.ts) porque un archivo de ruta de
// Next.js solo debe exportar los métodos HTTP.
export const NOMBRE_COOKIE_VERIFIER = "ml_code_verifier";
// state de OAuth (RFC 6749 §10.12, protección CSRF) — ver generarState()
// en lib/ml/oauth.ts para el motivo real.
export const NOMBRE_COOKIE_STATE = "ml_oauth_state";
