// Nombres de las cookies httpOnly que viajan entre /api/canva/conectar
// (las genera) y /api/canva/callback (las usa y las borra) — mismo
// patrón que lib/ml/pkce-cookie.ts.
export const NOMBRE_COOKIE_VERIFIER = "canva_code_verifier";
export const NOMBRE_COOKIE_STATE = "canva_oauth_state";
