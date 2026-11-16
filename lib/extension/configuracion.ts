// Configuración que la extensión de Chrome lee desde la plataforma
// (GET /api/extension/config) en vez de tenerla fija en su código. Así
// un texto o un interruptor se cambia con un deploy normal, sin
// esperar la revisión de la Chrome Web Store.
//
// Solo valores NO sensibles: la ruta es pública (la extensión la pide
// sin sesión) y nunca devuelve datos de una empresa. La extensión
// vuelve a validar todo lo que recibe y, si algo falla, usa sus
// valores por defecto seguros (extension/config.js).

export const VERSION_CONFIG_EXTENSION = 1;

// Producción de Zilonix Seller. Staging NO se lista acá: la extensión
// ya sabe en qué ambiente está por la pestaña que la persona abre.
export const URL_APP_PRODUCCION = "https://seller.zilonix.com";

export type InterruptoresExtension = {
  // Alibaba está EN PAUSA (issue #414): su botón queda oculto —en la
  // plataforma y en la extensión— hasta que se encienda a propósito.
  alibaba: boolean;
};

export const INTERRUPTORES_EXTENSION: Readonly<InterruptoresExtension> = {
  alibaba: false,
};

export type ConfigExtension = {
  version: number;
  urlApp: string;
  interruptores: InterruptoresExtension;
  textos: { avisoSinSesion: string };
};

export function configExtension(urlApp: string | null = null): ConfigExtension {
  return {
    version: VERSION_CONFIG_EXTENSION,
    urlApp: urlApp ?? URL_APP_PRODUCCION,
    interruptores: { ...INTERRUPTORES_EXTENSION },
    textos: { avisoSinSesion: "Inicia sesión en Zilonix Seller para analizar" },
  };
}
