import { createCipheriv, createDecipheriv, randomBytes } from "crypto";

// Tarea 2.3 — "tokens cifrados con versión de clave (para poder rotarla
// sin perder acceso)", regla de CLAUDE.md. AES-256-GCM con la librería
// nativa de Node, sin agregar ninguna dependencia nueva.
//
// La clave vive en Railway como `ML_TOKEN_KEY_V1` (32 bytes en base64).
// Rotar: agregar `ML_TOKEN_KEY_V2` y fijar `ML_TOKEN_KEY_ACTUAL=2`.
// Lo ya cifrado se sigue DESCIFRANDO con el número guardado en cada
// fila; solo lo nuevo usa la versión actual. Borrar la clave vieja
// antes de re-cifrar esas filas las deja ilegibles — el paso a paso
// está en docs/rotacion-claves.md. Nunca hay que volver a autorizar
// cuentas de Mercado Libre solo por rotar la clave.
//
// Se lee en cada cifrado y no al importar el módulo: un valor fijado
// al cargar se quedaría en 1 para todo el proceso aunque la variable
// ya estuviera en el entorno de la prueba (o llegara después del
// primer import). En Railway el proceso arranca con la variable ya
// puesta, así que dentro de un mismo proceso no cambia.

export function versionClaveActual(): number {
  const crudo = process.env.ML_TOKEN_KEY_ACTUAL;
  if (crudo === undefined || crudo.trim() === "") return 1;
  // No se repite el valor en el error: si alguien pegó la clave en
  // esta variable por error, el mensaje no puede devolverla.
  if (!/^[1-9]\d{0,2}$/.test(crudo.trim())) {
    throw new Error("ML_TOKEN_KEY_ACTUAL debe ser un entero entre 1 y 999.");
  }
  return Number(crudo.trim());
}

export type TokenCifrado = {
  version: number;
  iv: string;
  authTag: string;
  datos: string;
};

function clavePorVersion(version: number): Buffer {
  const variable = `ML_TOKEN_KEY_V${version}`;
  const valor = process.env[variable];
  if (!valor) throw new Error(`Falta la variable de entorno ${variable} para descifrar/cifrar tokens.`);
  const clave = Buffer.from(valor, "base64");
  if (clave.length !== 32) throw new Error(`${variable} debe ser una clave de 32 bytes en base64.`);
  return clave;
}

export function cifrarToken(textoPlano: string): TokenCifrado {
  const iv = randomBytes(12); // GCM: 12 bytes es el tamaño recomendado
  const version = versionClaveActual();
  const cipher = createCipheriv("aes-256-gcm", clavePorVersion(version), iv);
  const datos = Buffer.concat([cipher.update(textoPlano, "utf8"), cipher.final()]);
  return {
    version,
    iv: iv.toString("base64"),
    authTag: cipher.getAuthTag().toString("base64"),
    datos: datos.toString("base64"),
  };
}

export function descifrarToken(token: TokenCifrado): string {
  const decipher = createDecipheriv("aes-256-gcm", clavePorVersion(token.version), Buffer.from(token.iv, "base64"));
  decipher.setAuthTag(Buffer.from(token.authTag, "base64"));
  const textoPlano = Buffer.concat([decipher.update(Buffer.from(token.datos, "base64")), decipher.final()]);
  return textoPlano.toString("utf8");
}
