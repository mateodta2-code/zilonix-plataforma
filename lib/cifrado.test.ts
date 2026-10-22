import { randomBytes } from "crypto";
import { beforeEach, describe, expect, it } from "vitest";
import { cifrarToken, descifrarToken } from "./cifrado";

function claveDePrueba(): string {
  return randomBytes(32).toString("base64");
}

describe("cifrado de tokens (tarea 2.3)", () => {
  beforeEach(() => {
    process.env.ML_TOKEN_KEY_V1 = claveDePrueba();
    delete process.env.ML_TOKEN_KEY_V2;
    // Si esta variable queda puesta (en el entorno, o por otra prueba),
    // lo nuevo saldría con otra versión y este archivo dejaría de
    // describir el caso "sin rotar".
    delete process.env.ML_TOKEN_KEY_ACTUAL;
  });

  it("cifra y descifra el mismo texto", () => {
    const token = cifrarToken("APP_USR-token-real-de-mercado-libre");
    expect(token.datos).not.toContain("APP_USR"); // nunca en texto plano
    expect(descifrarToken(token)).toBe("APP_USR-token-real-de-mercado-libre");
  });

  it("guarda la versión de la clave usada", () => {
    const token = cifrarToken("algo");
    expect(token.version).toBe(1);
  });

  it("sin la variable de entorno de la clave, falla en vez de guardar algo sin cifrar", () => {
    delete process.env.ML_TOKEN_KEY_V1;
    expect(() => cifrarToken("algo")).toThrow();
  });

  it("rotar la clave: lo cifrado con la v1 se sigue descifrando aunque ya exista una v2", () => {
    const token = cifrarToken("token-viejo-con-clave-v1");
    process.env.ML_TOKEN_KEY_V2 = claveDePrueba();
    // la clave v1 sigue en el entorno — rotar no significa borrarla
    expect(descifrarToken(token)).toBe("token-viejo-con-clave-v1");
  });

  it("con V1 y V2 presentes, lo viejo se descifra y lo nuevo sale con la versión actual", () => {
    const viejo = cifrarToken("token-viejo-con-clave-v1");
    expect(viejo.version).toBe(1);
    process.env.ML_TOKEN_KEY_V2 = claveDePrueba();
    process.env.ML_TOKEN_KEY_ACTUAL = " 2 ";
    expect(viejo.version).toBe(1);
    expect(descifrarToken(viejo)).toBe("token-viejo-con-clave-v1");
    const nuevo = cifrarToken("token-nuevo-con-clave-v2");
    expect(nuevo.version).toBe(2);
    expect(descifrarToken(nuevo)).toBe("token-nuevo-con-clave-v2");
  });

  it("sin ML_TOKEN_KEY_ACTUAL, o vacía, la versión actual sigue siendo 1", () => {
    delete process.env.ML_TOKEN_KEY_ACTUAL;
    expect(cifrarToken("algo").version).toBe(1);
    process.env.ML_TOKEN_KEY_ACTUAL = "   ";
    expect(cifrarToken("algo").version).toBe(1);
  });

  it("un ML_TOKEN_KEY_ACTUAL inválido falla sin repetir el valor", () => {
    const valorPegadoPorError = claveDePrueba();
    process.env.ML_TOKEN_KEY_ACTUAL = valorPegadoPorError;
    expect(() => cifrarToken("algo")).toThrowError(
      /^ML_TOKEN_KEY_ACTUAL debe ser un entero entre 1 y 999\.$/
    );
    try {
      cifrarToken("algo");
    } catch (error) {
      const mensaje = error instanceof Error ? error.message : String(error);
      expect(mensaje).not.toContain(valorPegadoPorError);
    }
  });

  it("una clave de menos de 32 bytes falla en vez de cifrar débil", () => {
    process.env.ML_TOKEN_KEY_V1 = Buffer.from("muy-corta").toString("base64");
    expect(() => cifrarToken("algo")).toThrow();
  });

  it("no se puede descifrar con la clave de otra versión", () => {
    const token = cifrarToken("algo");
    token.version = 2;
    process.env.ML_TOKEN_KEY_V2 = claveDePrueba(); // clave distinta a la v1
    expect(() => descifrarToken(token)).toThrow();
  });
});
