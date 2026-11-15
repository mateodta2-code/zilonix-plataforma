import { beforeEach, describe, expect, it, vi } from "vitest";

// Sin Postgres ni Clerk reales: se prueba el rechazo sin sesión de
// CADA ruta de /superadmin y las reglas de entrada de
// requiereSesionSuperadmin().
vi.mock("server-only", () => ({}));
const { redirectMock, insertMock } = vi.hoisted(() => ({
  redirectMock: vi.fn((url: string) => {
    throw new Error(`REDIRECT:${url}`);
  }),
  insertMock: vi.fn(),
}));
vi.mock("next/navigation", () => ({ redirect: (u: string) => redirectMock(u) }));
const estado = vi.hoisted(() => ({ cookie: undefined as string | undefined, clerk: null as unknown, fila: [] as unknown[] }));
vi.mock("next/headers", () => ({
  cookies: () => ({ get: () => (estado.cookie ? { value: estado.cookie } : undefined), set: vi.fn() }),
}));
vi.mock("@clerk/nextjs/server", () => ({
  currentUser: async () => estado.clerk,
  auth: async () => ({ sessionId: null }),
  clerkClient: async () => ({}),
}));
vi.mock("@/db", () => ({
  db: { select: () => ({ from: () => ({ where: async () => estado.fila }) }), insert: insertMock },
}));
vi.mock("@/db/superadmin-context", () => ({ dbSuperadmin: {} }));
vi.mock("@/lib/foro", () => ({ cambiarVisibilidad: vi.fn(), listarParaModerar: vi.fn() }));

import { requiereSesionSuperadmin } from "./superadmin";
import { firmarCookieSuperadmin } from "./superadmin-sesion";

const SECRETO = "secreto-de-prueba-solo-tests";
const clerkUser = (correo = "ok@x.com", estado = "verified", twoFactorEnabled = false) => ({
  id: "user_1",
  twoFactorEnabled,
  primaryEmailAddress: { emailAddress: correo, verification: { status: estado } },
});

beforeEach(() => {
  redirectMock.mockClear();
  insertMock.mockClear();
  estado.cookie = undefined;
  estado.clerk = null;
  estado.fila = [];
  process.env.SUPERADMIN_SESION_SECRETO = SECRETO;
  process.env.SUPERADMIN_CORREOS = "OK@x.com";
  delete process.env.SUPERADMIN_EXIGIR_2FA;
});

describe("requiereSesionSuperadmin", () => {
  it("sin sesión de Clerk → login aparte", async () => {
    await expect(requiereSesionSuperadmin()).rejects.toThrow("REDIRECT:/superadmin/iniciar-sesion");
  });
  it("correo fuera de la lista o no verificado → rechazado, sin tocar la base ni crear filas", async () => {
    estado.clerk = clerkUser("intruso@x.com");
    await expect(requiereSesionSuperadmin()).rejects.toThrow("no-autorizado");
    estado.clerk = clerkUser("ok@x.com", "unverified");
    await expect(requiereSesionSuperadmin()).rejects.toThrow("no-autorizado");
    expect(insertMock).not.toHaveBeenCalled();
  });
  it("lista vacía o sin secreto → cerrado", async () => {
    estado.clerk = clerkUser();
    process.env.SUPERADMIN_CORREOS = "";
    await expect(requiereSesionSuperadmin()).rejects.toThrow("motivo=cerrado");
    process.env.SUPERADMIN_CORREOS = "ok@x.com";
    delete process.env.SUPERADMIN_SESION_SECRETO;
    await expect(requiereSesionSuperadmin()).rejects.toThrow("motivo=cerrado");
  });
  it("en la lista pero sin es_superadmin → rechazado", async () => {
    estado.clerk = clerkUser();
    estado.fila = [{ id: "u1", esSuperadmin: false }];
    await expect(requiereSesionSuperadmin()).rejects.toThrow("no-autorizado");
  });
  it("sin cookie válida o con cookie de otro usuario → login aparte", async () => {
    estado.clerk = clerkUser();
    estado.fila = [{ id: "u1", esSuperadmin: true }];
    await expect(requiereSesionSuperadmin()).rejects.toThrow("REDIRECT:/superadmin/iniciar-sesion");
    estado.cookie = await firmarCookieSuperadmin("user_otro", Date.now(), SECRETO);
    await expect(requiereSesionSuperadmin()).rejects.toThrow("REDIRECT:/superadmin/iniciar-sesion");
  });
  it("2FA exigida y la cuenta no la tiene → rechazado; con 2FA pasa", async () => {
    process.env.SUPERADMIN_EXIGIR_2FA = "true";
    estado.clerk = clerkUser();
    estado.fila = [{ id: "u1", esSuperadmin: true }];
    estado.cookie = await firmarCookieSuperadmin("user_1", Date.now(), SECRETO);
    await expect(requiereSesionSuperadmin()).rejects.toThrow("motivo=2fa");
    estado.clerk = clerkUser("ok@x.com", "verified", true);
    await expect(requiereSesionSuperadmin()).resolves.toEqual({ usuarioId: "u1", clerkUserId: "user_1" });
  });
  it("todo en regla + cookie válida → entra", async () => {
    estado.clerk = clerkUser();
    estado.fila = [{ id: "u1", esSuperadmin: true }];
    estado.cookie = await firmarCookieSuperadmin("user_1", Date.now(), SECRETO);
    await expect(requiereSesionSuperadmin()).resolves.toEqual({ usuarioId: "u1", clerkUserId: "user_1" });
  });
});

describe("cada ruta de /superadmin rechaza sin sesión", () => {
  const rutas: [string, () => Promise<unknown>][] = [
    ["page", async () => (await import("@/app/superadmin/page")).default()],
    ["[empresaId]", async () => (await import("@/app/superadmin/[empresaId]/page")).default({ params: { empresaId: "x" } })],
    ["foro/page", async () => (await import("@/app/superadmin/foro/page")).default()],
    ["foro/actions", async () => (await import("@/app/superadmin/foro/actions")).cambiarVisibilidadAction(new FormData())],
    ["entrar", async () => {
      const res = await (await import("@/app/superadmin/entrar/route")).GET(new Request("https://x.test/superadmin/entrar") as never);
      expect(res.headers.get("location")).toContain("/superadmin/iniciar-sesion");
      expect(res.headers.get("set-cookie")).toBeNull();
      throw new Error("REDIRECT:/superadmin/iniciar-sesion");
    }],
  ];
  for (const [nombre, llamar] of rutas) {
    it(nombre, async () => {
      await expect(llamar()).rejects.toThrow("REDIRECT:/superadmin/iniciar-sesion");
    });
  }
});
