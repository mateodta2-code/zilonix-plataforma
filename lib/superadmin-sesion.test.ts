import { describe, expect, it } from "vitest";
import {
  INACTIVIDAD_SUPERADMIN_MS,
  correoEstaAutorizado,
  firmarCookieSuperadmin,
  parsearCorreosSuperadmin,
  verificarCookieSuperadmin,
} from "./superadmin-sesion";

describe("lista de correos de superadmin", () => {
  it("vacía o ausente: nadie entra", () => {
    expect(parsearCorreosSuperadmin(undefined)).toEqual([]);
    expect(parsearCorreosSuperadmin("")).toEqual([]);
    expect(parsearCorreosSuperadmin(" , ,")).toEqual([]);
    expect(correoEstaAutorizado("a@x.com", [])).toBe(false);
  });
  it("ignora mayúsculas y espacios", () => {
    const lista = parsearCorreosSuperadmin("  Mateo@Ejemplo.com ,otra@x.com ");
    expect(lista).toEqual(["mateo@ejemplo.com", "otra@x.com"]);
    expect(correoEstaAutorizado(" MATEO@ejemplo.COM", lista)).toBe(true);
    expect(correoEstaAutorizado("intruso@x.com", lista)).toBe(false);
    expect(correoEstaAutorizado(null, lista)).toBe(false);
  });
});

describe("cookie zx_superadmin", () => {
  const secreto = "secreto-de-prueba-solo-tests";
  const ahora = 1_700_000_000_000;

  it("válida para el mismo usuario dentro de los 30 min", async () => {
    const c = await firmarCookieSuperadmin("user_1", ahora, secreto);
    expect(await verificarCookieSuperadmin(c, "user_1", ahora + 1000, secreto)).toBe(true);
  });
  it("vencida", async () => {
    const c = await firmarCookieSuperadmin("user_1", ahora, secreto);
    expect(await verificarCookieSuperadmin(c, "user_1", ahora + INACTIVIDAD_SUPERADMIN_MS + 1, secreto)).toBe(false);
  });
  it("manipulada (carga o firma alteradas) o con otro secreto", async () => {
    const c = await firmarCookieSuperadmin("user_1", ahora, secreto);
    const [carga, firma] = c.split(".");
    const otraCarga = btoa(JSON.stringify({ u: "user_1", exp: ahora + 99_999_999_999 })).replace(/=+$/, "");
    expect(await verificarCookieSuperadmin(`${otraCarga}.${firma}`, "user_1", ahora, secreto)).toBe(false);
    expect(await verificarCookieSuperadmin(`${carga}.${firma.slice(0, -2)}AA`, "user_1", ahora, secreto)).toBe(false);
    expect(await verificarCookieSuperadmin("basura", "user_1", ahora, secreto)).toBe(false);
    expect(await verificarCookieSuperadmin(c, "user_1", ahora, "otro-secreto-de-prueba-solo-tests")).toBe(false);
  });
  it("de otro usuario", async () => {
    const c = await firmarCookieSuperadmin("user_1", ahora, secreto);
    expect(await verificarCookieSuperadmin(c, "user_2", ahora, secreto)).toBe(false);
  });
  it("sin secreto o sin cookie: nadie entra", async () => {
    const c = await firmarCookieSuperadmin("user_1", ahora, secreto);
    expect(await verificarCookieSuperadmin(c, "user_1", ahora, undefined)).toBe(false);
    expect(await verificarCookieSuperadmin(undefined, "user_1", ahora, secreto)).toBe(false);
  });
});
