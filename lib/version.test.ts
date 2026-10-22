import { afterEach, describe, expect, it } from "vitest";
import { GET } from "../app/api/version/route";
import { COMMIT_DESCONOCIDO, VERSION, commitDesplegado } from "./version";

const SHA_RAILWAY = "d0beb8f5c55b36df7d674d55965a23b8d54ad69b";
const VARIABLE = "RAILWAY_GIT_COMMIT_SHA";

// El valor real del entorno (CI, local) no debe filtrarse entre pruebas.
const shaPrevio = process.env[VARIABLE];

function fijarSha(valor: string | undefined) {
  if (valor === undefined) delete process.env[VARIABLE];
  else process.env[VARIABLE] = valor;
}

afterEach(() => {
  fijarSha(shaPrevio);
});

describe("version", () => {
  it("sigue el formato semver (x.y.z)", () => {
    expect(VERSION).toMatch(/^\d+\.\d+\.\d+$/);
  });
});

describe("commitDesplegado", () => {
  it("publica los primeros 7 caracteres de RAILWAY_GIT_COMMIT_SHA", () => {
    fijarSha(SHA_RAILWAY);
    expect(commitDesplegado()).toBe("d0beb8f");
  });

  it("normaliza mayúsculas y espacios", () => {
    fijarSha(`  ${SHA_RAILWAY.toUpperCase()}  `);
    expect(commitDesplegado()).toBe("d0beb8f");
  });

  it('es "desconocido" si la variable no está (local y CI)', () => {
    fijarSha(undefined);
    expect(commitDesplegado()).toBe(COMMIT_DESCONOCIDO);
  });

  it('es "desconocido" si está vacía o no es un SHA', () => {
    fijarSha("");
    expect(commitDesplegado()).toBe(COMMIT_DESCONOCIDO);
    fijarSha("   ");
    expect(commitDesplegado()).toBe(COMMIT_DESCONOCIDO);
    fijarSha("abc123");
    expect(commitDesplegado()).toBe(COMMIT_DESCONOCIDO);
    fijarSha("no-es-un-sha");
    expect(commitDesplegado()).toBe(COMMIT_DESCONOCIDO);
    fijarSha("abc1234\nRAILWAY_GIT_BRANCH=main");
    expect(commitDesplegado()).toBe(COMMIT_DESCONOCIDO);
  });
});

describe("GET /api/version", () => {
  it("responde solo version y el commit corto", async () => {
    fijarSha(SHA_RAILWAY);
    const extras = ["RAILWAY_GIT_BRANCH", "RAILWAY_GIT_COMMIT_MESSAGE", "DATABASE_URL"] as const;
    const previos = Object.fromEntries(extras.map((clave) => [clave, process.env[clave]]));
    process.env.RAILWAY_GIT_BRANCH = "main";
    process.env.RAILWAY_GIT_COMMIT_MESSAGE = "no debe salir";
    process.env.DATABASE_URL = "postgresql://no-debe-salir";

    try {
      const respuesta = await GET();
      expect(respuesta.status).toBe(200);
      expect(respuesta.headers.get("content-type")).toMatch(/application\/json/);

      const cuerpo = await respuesta.json();
      expect(cuerpo).toEqual({ version: VERSION, commit: "d0beb8f" });
      expect(Object.keys(cuerpo).sort()).toEqual(["commit", "version"]);
    } finally {
      for (const clave of extras) {
        if (previos[clave] === undefined) delete process.env[clave];
        else process.env[clave] = previos[clave];
      }
    }
  });

  it('sin la variable de Railway, commit es "desconocido"', async () => {
    fijarSha(undefined);
    const cuerpo = await (await GET()).json();
    expect(cuerpo).toEqual({ version: VERSION, commit: COMMIT_DESCONOCIDO });
  });
});
