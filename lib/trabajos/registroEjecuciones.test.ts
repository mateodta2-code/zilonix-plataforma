import { beforeEach, describe, expect, it, vi } from "vitest";

const execute = vi.fn(async () => []);
vi.mock("@/db/trabajador-context", () => ({ dbTrabajador: { execute } }));
vi.mock("@/db/trabajador-publicidad-context", () => ({ dbTrabajadorPublicidad: { execute } }));
vi.mock("@/db/trabajador-seguimiento-context", () => ({ dbTrabajadorSeguimiento: { execute } }));

import { ejecutarConRegistro, errorCorto, soloConteos } from "./registroEjecuciones";

// El texto del SQL que se mandó, con sus parámetros.
function parametrosDe(llamada: unknown[]): unknown[] {
  const consulta = llamada[0] as { queryChunks: unknown[] };
  return consulta.queryChunks.filter((c) => typeof c !== "object" || c === null || !("value" in (c as object)));
}

describe("soloConteos (D8)", () => {
  it("deja solo los números finitos", () => {
    expect(soloConteos({ procesados: 3, fallidos: 0, sigue: true, nickname: "VENDEDOR", infinito: Infinity, lista: [1] })).toEqual({ procesados: 3, fallidos: 0 });
  });

  it("cualquier cosa que no sea un objeto da un resumen vacío", () => {
    expect(soloConteos(null)).toEqual({});
    expect(soloConteos([1, 2])).toEqual({});
    expect(soloConteos("texto")).toEqual({});
  });
});

describe("errorCorto", () => {
  it("nunca guarda una URL (cadena de conexión, token)", () => {
    const texto = errorCorto(new Error("no conecta a postgresql://user:clave@host:5432/db ni a https://api.x.com/?token=abc"));
    expect(texto).toBe("Error: no conecta a [url] ni a [url]");
  });

  it("recorta a 300 caracteres y tolera lo que no es un Error", () => {
    expect(errorCorto(new Error("x".repeat(500)))).toHaveLength(300);
    expect(errorCorto("algo")).toBe("Error desconocido");
  });
});

describe("ejecutarConRegistro", () => {
  beforeEach(() => execute.mockClear());

  it("devuelve el resultado y anota la corrida", async () => {
    await expect(ejecutarConRegistro("avisos_ml", async () => ({ procesados: 5 }))).resolves.toEqual({ procesados: 5 });
    expect(execute).toHaveBeenCalledTimes(1);
    expect(parametrosDe(execute.mock.calls[0])).toEqual(expect.arrayContaining(["avisos_ml", true, JSON.stringify({ procesados: 5 }), null]));
  });

  it("si el proceso falla, anota el fallo y vuelve a lanzar el error", async () => {
    await expect(ejecutarConRegistro("publicidad", async () => { throw new Error("se cayó"); })).rejects.toThrow("se cayó");
    expect(parametrosDe(execute.mock.calls[0])).toEqual(expect.arrayContaining(["publicidad", false, "{}", "Error: se cayó"]));
  });

  it("si anotar falla, el proceso igual responde", async () => {
    execute.mockRejectedValueOnce(new Error("la base no responde"));
    const consola = vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(ejecutarConRegistro("seguimiento", async () => ({ activos: 1 }))).resolves.toEqual({ activos: 1 });
    expect(consola).toHaveBeenCalled();
    consola.mockRestore();
  });
});
