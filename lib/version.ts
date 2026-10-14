// Única fuente de verdad de la versión — pie de página y /api/version
// leen de acá, nunca se escribe el número en dos lugares distintos.
import packageJson from "../package.json";

export const VERSION = packageJson.version;
