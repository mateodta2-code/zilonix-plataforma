import { createCipheriv, createDecipheriv, randomBytes } from "crypto";

// Tarea 2.3 — "tokens cifrados con versión de clave (para poder rotarla
// sin perder acceso)", regla de CLAUDE.md. AES-256-GCM con la librería
// nativa de Node, sin agregar ninguna dependencia nueva.
//
// La clave vive en Railway como `ML_TOKEN_KEY_V1` (32 bytes en base64).
// Rotar la clave: agregar `ML_TOKEN_KEY_V2`, pasar CLAVE_ACTUAL a 2 —
// todo lo cifrado con la v1 se sigue pudiendo DESCIFRAR (la función de
// abajo busca la clave por el número guardado en cada fila), solo lo
// nuevo que se cifre de ahí en adelante usa la v2. Nunca hay que volver
// a autorizar cuentas de Mercado Libre solo por rotar la clave.

const CLAVE_ACTUAL = 1;

export type TokenCifrado = {
  version: number;
  iv: string;
  authTag: string;
  datos: string;
};

// Revisión del PR #415: un solo helper AES-256-GCM, parametrizado por el
// prefijo de la variable de entorno. Cada marketplace usa su PROPIA clave
// (ML_TOKEN_KEY_Vn, FALABELLA_TOKEN_KEY_Vn): si una se filtra o hay que
// rotarla, la otra no se ve afectada. Formato de cada clave: 32 bytes
// aleatorios en base64 (ej. `openssl rand -base64 32`).
type PrefijoClave = "ML_TOKEN_KEY" | "FALABELLA_TOKEN_KEY";

function clavePorVersion(prefijo: PrefijoClave, version: number): Buffer {
  const variable = `${prefijo}_V${version}`;
  const valor = process.env[variable];
  if (!valor) throw new Error(`Falta la variable de entorno ${variable} para descifrar/cifrar tokens.`);
  const clave = Buffer.from(valor, "base64");
  if (clave.length !== 32) throw new Error(`${variable} debe ser una clave de 32 bytes en base64.`);
  return clave;
}

function cifrarCon(prefijo: PrefijoClave, textoPlano: string): TokenCifrado {
  const iv = randomBytes(12); // GCM: 12 bytes es el tamaño recomendado
  const cipher = createCipheriv("aes-256-gcm", clavePorVersion(prefijo, CLAVE_ACTUAL), iv);
  const datos = Buffer.concat([cipher.update(textoPlano, "utf8"), cipher.final()]);
  return {
    version: CLAVE_ACTUAL,
    iv: iv.toString("base64"),
    authTag: cipher.getAuthTag().toString("base64"),
    datos: datos.toString("base64"),
  };
}

function descifrarCon(prefijo: PrefijoClave, token: TokenCifrado): string {
  const decipher = createDecipheriv("aes-256-gcm", clavePorVersion(prefijo, token.version), Buffer.from(token.iv, "base64"));
  decipher.setAuthTag(Buffer.from(token.authTag, "base64"));
  const textoPlano = Buffer.concat([decipher.update(Buffer.from(token.datos, "base64")), decipher.final()]);
  return textoPlano.toString("utf8");
}

export function cifrarToken(textoPlano: string): TokenCifrado {
  return cifrarCon("ML_TOKEN_KEY", textoPlano);
}

export function descifrarToken(token: TokenCifrado): string {
  return descifrarCon("ML_TOKEN_KEY", token);
}

// Conector Falabella: misma mecánica, clave propia FALABELLA_TOKEN_KEY_Vn.
export function cifrarTokenFalabella(textoPlano: string): TokenCifrado {
  return cifrarCon("FALABELLA_TOKEN_KEY", textoPlano);
}

export function descifrarTokenFalabella(token: TokenCifrado): string {
  return descifrarCon("FALABELLA_TOKEN_KEY", token);
}
