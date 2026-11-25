// Posventa-Mensajes (Refs #645) — reglas de adjuntos, puras: las usan el
// navegador (para avisar antes de enviar) y el servidor (que vuelve a
// validar, porque el navegador no es de fiar). Se valida SIEMPRE antes de
// llamar a Mercado Libre.

export const MAX_ADJUNTOS_POR_MENSAJE = 3;
export const MAX_CARACTERES_MENSAJE = 350;

export type ReglasAdjunto = { maxBytes: number; tipos: readonly string[]; extensiones: readonly string[]; etiqueta: string };

// Mensajes de venta: GET/POST /messages/attachments (máx 25 MB).
export const REGLAS_ADJUNTO_MENSAJE: ReglasAdjunto = {
  maxBytes: 25 * 1024 * 1024,
  tipos: ["image/jpeg", "image/png", "application/pdf", "image/heif", "image/heic", "image/gif"],
  extensiones: ["jpg", "jpeg", "png", "pdf", "heif", "heic", "gif"],
  etiqueta: "JPG, PNG, PDF, HEIF, HEIC o GIF, de hasta 25 MB",
};

// Reclamos: POST /post-purchase/v1/claims/{id}/attachments (máx 5 MB).
export const REGLAS_ADJUNTO_RECLAMO: ReglasAdjunto = {
  maxBytes: 5 * 1024 * 1024,
  tipos: ["image/jpeg", "image/png", "application/pdf", "text/plain"],
  extensiones: ["jpg", "jpeg", "png", "pdf", "txt"],
  etiqueta: "JPG, PNG, PDF o TXT, de hasta 5 MB",
};

export type ArchivoParaValidar = { nombre: string; tipo: string; tamano: number };

function extensionDe(nombre: string): string {
  const punto = nombre.lastIndexOf(".");
  return punto === -1 ? "" : nombre.slice(punto + 1).toLowerCase();
}

// null = válido; si no, el motivo en lenguaje simple.
export function validarAdjunto(archivo: ArchivoParaValidar, reglas: ReglasAdjunto): string | null {
  if (!Number.isFinite(archivo.tamano) || archivo.tamano <= 0) return `«${archivo.nombre}» está vacío.`;
  if (archivo.tamano > reglas.maxBytes) return `«${archivo.nombre}» pesa demasiado. Se permite ${reglas.etiqueta}.`;
  const tipo = archivo.tipo.toLowerCase();
  // Algunos navegadores no informan el tipo de HEIC/HEIF: se acepta por extensión.
  const tipoOk = reglas.tipos.includes(tipo) || (tipo === "" && reglas.extensiones.includes(extensionDe(archivo.nombre)));
  if (!tipoOk || !reglas.extensiones.includes(extensionDe(archivo.nombre))) return `«${archivo.nombre}» no es de un tipo permitido. Se permite ${reglas.etiqueta}.`;
  return null;
}

export function validarAdjuntos(archivos: ArchivoParaValidar[], reglas: ReglasAdjunto): string | null {
  if (archivos.length > MAX_ADJUNTOS_POR_MENSAJE) return `Máximo ${MAX_ADJUNTOS_POR_MENSAJE} adjuntos por mensaje.`;
  for (const a of archivos) {
    const motivo = validarAdjunto(a, reglas);
    if (motivo) return motivo;
  }
  return null;
}

// null = válido.
export function validarTextoMensaje(texto: string, hayAdjuntos: boolean): string | null {
  const limpio = texto.trim();
  if (!limpio && !hayAdjuntos) return "Escribe un mensaje o adjunta un archivo.";
  if (texto.length > MAX_CARACTERES_MENSAJE) return `El mensaje no puede pasar de ${MAX_CARACTERES_MENSAJE} caracteres.`;
  return null;
}
