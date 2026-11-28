// Falabella responde sus rechazos en inglés ("Field 'X' cannot be empty").
// Se traducen a una frase en español que dice QUÉ corregir. Lo que no se
// reconoce se deja tal cual (nunca se inventa una explicación).

function limpiar(t: string): string {
  return t.replace(/&#0?39;|&apos;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").trim();
}

const REGLAS: { patron: RegExp; texto: (m: RegExpMatchArray) => string }[] = [
  {
    patron: /^Field '([^']+)' cannot be empty\.?$/i,
    texto: (m) => `Falta llenar «${m[1]}»: esta categoría de Falabella lo exige. Complétalo en «Características de la categoría — Falabella».`,
  },
  {
    patron: /^Field '([^']+)' with value '([^']*)' does not appear to be a valid option\.?$/i,
    texto: (m) => `«${m[2]}» no es una opción válida para «${m[1]}». Elige una de la lista que ofrece Falabella.`,
  },
  {
    patron: /^(\w+) is\/are not applicable to (.+)$/i,
    texto: (m) => `«${m[1]}» no aplica a la categoría «${m[2]}». Se quita al corregir; si la categoría no es la correcta, descarta y elige otra.`,
  },
  {
    patron: /^Field '([^']+)' (?:is|has) (?:too long|exceeds.*)\.?$/i,
    texto: (m) => `«${m[1]}» es demasiado largo para Falabella. Acórtalo.`,
  },
  {
    patron: /^Field '([^']+)' (?:must be|is not) (?:a )?(?:valid )?(?:number|numeric|integer)\.?$/i,
    texto: (m) => `«${m[1]}» debe ser un número.`,
  },
];

export function traducirErrorFalabella(mensaje: string): string {
  const limpio = limpiar(mensaje);
  for (const { patron, texto } of REGLAS) {
    const m = limpio.match(patron);
    if (m) return texto(m);
  }
  return limpio;
}

// Campos que Falabella dice que faltan o que tienen un valor inválido: se
// ofrecen para llenar de nuevo en el historial.
export function camposAcorregir(errores: string[]): string[] {
  const nombres = new Set<string>();
  for (const e of errores) {
    const m = limpiar(e).match(/^Field '([^']+)'/i);
    if (m && /^[A-Za-z][A-Za-z0-9_]{0,60}$/.test(m[1])) nombres.add(m[1]);
  }
  return [...nombres];
}
