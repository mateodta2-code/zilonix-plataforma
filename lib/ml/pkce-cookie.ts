// Nombre de la cookie httpOnly que guarda el code_verifier de PKCE
// entre /api/ml/conectar (lo genera) y /api/ml/callback (lo usa) —
// aparte en su propio archivo (no en un route.ts) porque un archivo de
// ruta de Next.js solo debe exportar los métodos HTTP.
export const NOMBRE_COOKIE_VERIFIER = "ml_code_verifier";
