// Rama feat-publicar-clip, punto 1 ("Desde la extensión") — receptor
// de postMessage para {fuente:"zilonix-extension", tipo:"importar-video",
// payload:{url}}, "valida igual que el link" (nunca confía en el
// mensaje a ciegas, mismo criterio que itemImportadoDesdeMensajeExtension
// en formulario-logica.ts para "importar-publicar"). La comparación de
// `evento.source` contra el objeto `window` real queda INLINE en
// SeccionClip.tsx (identidad de objeto del DOM, no se puede probar sin
// un navegador real) — acá se extrae la parte que SÍ es pura: el
// origin ya resuelto a texto, y la forma del payload.
export function urlDeMensajeExtensionVideo(origenRecibido: string, origenEsperado: string, datos: unknown): string | null {
  if (origenRecibido !== origenEsperado) return null;
  const mensaje = datos as { fuente?: unknown; tipo?: unknown; payload?: { url?: unknown } } | null;
  if (!mensaje || mensaje.fuente !== "zilonix-extension" || mensaje.tipo !== "importar-video") return null;
  const url = mensaje.payload?.url;
  if (typeof url !== "string" || !url) return null;
  return url;
}
