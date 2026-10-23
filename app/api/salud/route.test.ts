import { readFileSync } from "fs";
import { beforeEach, describe, expect, it, vi } from "vitest";

// vi.mock se iza por encima de los import. Sin hoisted, la fábrica
// corre antes de que exista `execute` y el GET pegaría a la base real.
const { execute } = vi.hoisted(() => ({ execute: vi.fn() }));

vi.mock("@/db", () => ({
  db: {
    execute: (...args: unknown[]) => execute(...args),
  },
}));

import { GET, dynamic, revalidate } from "./route";

// Next no deja exportar constantes desde route.ts. El tope se lee del
// fuente para que la prueba de los 2 s use el mismo número que el handler.
function timeoutDelFuente(): number {
  const fuente = readFileSync(new URL("./route.ts", import.meta.url), "utf8");
  const encontrado = fuente.match(/const TIMEOUT_SALUD_MS = ([\d_]+)/);
  if (!encontrado) throw new Error("route.ts no declara TIMEOUT_SALUD_MS");
  return Number(encontrado[1].replaceAll("_", ""));
}

const ERROR_DEL_DRIVER =
  'connect ECONNREFUSED postgresql://app_user:no-imprimir@db.interno:5432/railway password authentication failed role "app_user"';

function textoDeLaConsulta(consulta: { queryChunks?: { value?: string[] }[] }): string {
  return (consulta.queryChunks ?? [])
    .map((trozo) => (Array.isArray(trozo.value) ? trozo.value.join("") : ""))
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
}

describe("GET /api/salud", () => {
  beforeEach(() => {
    execute.mockReset();
  });

  it("no se cachea: Next no debe prerenderizar el GET", () => {
    expect(dynamic).toBe("force-dynamic");
    expect(revalidate).toBe(0);
    expect(timeoutDelFuente()).toBe(2_000);
  });

  it("responde 200 solo con números y estados cuando la base contesta", async () => {
    // Si alguien cambia el select y la fila trajera un nombre o una
    // cadena de conexión, la respuesta igual no puede reflejarlo.
    execute.mockResolvedValue([{ nombre: "Empresa Secreta", url: "postgresql://app_user:secreto@db/railway" }]);

    const res = await GET();
    const texto = await res.text();

    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store, max-age=0");
    expect(texto).toBe(
      JSON.stringify({
        ok: true,
        base: "ok",
        edad_ultimo_trabajo_s: null,
        trabajos_muertos: null,
      })
    );
    expect(texto).not.toMatch(/Empresa Secreta|postgresql:|secreto|app_user/i);
    expect(textoDeLaConsulta(execute.mock.calls[0][0])).toBe("select 1");
  });

  it("responde 503 sin el error del driver cuando la base falla", async () => {
    execute.mockRejectedValue(new Error(ERROR_DEL_DRIVER));

    const res = await GET();
    const texto = await res.text();

    expect(res.status).toBe(503);
    expect(texto).toBe(
      JSON.stringify({
        ok: false,
        base: "caida",
        edad_ultimo_trabajo_s: null,
        trabajos_muertos: null,
      })
    );
    expect(texto).not.toMatch(/postgresql:|no-imprimir|app_user|ECONNREFUSED|password|railway|interno/i);
  });

  it("corta a los 2 s si la base no contesta, sin decir por qué", async () => {
    vi.useFakeTimers();
    try {
      const timeoutMs = timeoutDelFuente();
      execute.mockReturnValue(new Promise(() => {}));
      let asentada = false;
      const pendiente = GET().then((res) => {
        asentada = true;
        return res;
      });

      await vi.advanceTimersByTimeAsync(timeoutMs - 1);
      expect(asentada).toBe(false);

      await vi.advanceTimersByTimeAsync(1);
      const res = await pendiente;
      const texto = await res.text();

      expect(res.status).toBe(503);
      expect(texto).not.toMatch(/timeout|select|Error/i);
      expect(JSON.parse(texto)).toEqual({
        ok: false,
        base: "caida",
        edad_ultimo_trabajo_s: null,
        trabajos_muertos: null,
      });
    } finally {
      vi.useRealTimers();
    }
  });
});
