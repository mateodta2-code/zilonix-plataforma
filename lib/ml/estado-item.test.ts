import { randomUUID } from "crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { dbComoEmpresa } from "@/db/empresa-context";
import { cuentasMl, empresas } from "@/db/schema";
import { cifrarToken } from "@/lib/cifrado";
import { cambiarEstadoItemMl } from "./estado-item";

function jsonRes(status: number, data: unknown): Response {
  return { ok: status >= 200 && status < 300, status, text: async () => JSON.stringify(data) } as Response;
}

// Tarea 2.11, punto 3 — mismo helper que clip.test.ts/publicar.test.ts
// (cuentaIdExterna tiene que cumplir /^\d+$/, el patrón real de
// cliente.ts — un randomUUID() nunca lo pasa).
function cuentaIdExternaDePrueba(): string {
  return `${Date.now()}${Math.floor(Math.random() * 10_000)}`;
}

describe("cambiarEstadoItemMl (tarea 2.11, §11)", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("pausa/activa un ítem", async () => {
    const empresaId = randomUUID();
    await dbComoEmpresa(empresaId, (tx) => tx.insert(empresas).values({ id: empresaId, nombre: "Empresa estado-item", nit: `TEST-EI-${empresaId.slice(0, 8)}` }));
    const [cuenta] = await dbComoEmpresa(empresaId, (tx) =>
      tx
        .insert(cuentasMl)
        .values({
          empresaId,
          cuentaIdExterna: cuentaIdExternaDePrueba(),
          nickname: "VENDEDOR",
          accessTokenCifrado: cifrarToken("access"),
          refreshTokenCifrado: cifrarToken("refresh"),
          tokenExpiraTs: new Date(Date.now() + 3600_000),
        })
        .returning({ id: cuentasMl.id })
    );
    vi.stubGlobal("fetch", vi.fn(async () => jsonRes(200, { status: "paused" })));
    const r = await cambiarEstadoItemMl(empresaId, cuenta.id, "MCO111", false);
    expect(r.status).toBe("paused");
  });

  it("avisa claro cuando el ítem está bajo revisión (Mateo, 25/9)", async () => {
    const empresaId = randomUUID();
    await dbComoEmpresa(empresaId, (tx) => tx.insert(empresas).values({ id: empresaId, nombre: "Empresa estado-item 2", nit: `TEST-EI2-${empresaId.slice(0, 8)}` }));
    const [cuenta] = await dbComoEmpresa(empresaId, (tx) =>
      tx
        .insert(cuentasMl)
        .values({
          empresaId,
          cuentaIdExterna: cuentaIdExternaDePrueba(),
          nickname: "VENDEDOR",
          accessTokenCifrado: cifrarToken("access"),
          refreshTokenCifrado: cifrarToken("refresh"),
          tokenExpiraTs: new Date(Date.now() + 3600_000),
        })
        .returning({ id: cuentasMl.id })
    );
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, status: 400, text: async () => "item.status.not_modifiable" }) as Response));
    await expect(cambiarEstadoItemMl(empresaId, cuenta.id, "MCO111", true)).rejects.toThrow(/todavía está revisando/);
  });

  // Tarea 2.11, punto 3 — itemId viene de formData (app/panel/publicar/
  // clip/actions.ts, cambiarEstadoAction, línea 63) — se valida ANTES
  // de armar la URL, nunca se llama a Mercado Libre con algo así.
  it("itemId inválido nunca llama a fetch", async () => {
    const empresaId = randomUUID();
    await dbComoEmpresa(empresaId, (tx) => tx.insert(empresas).values({ id: empresaId, nombre: "Empresa estado-item 3", nit: `TEST-EI3-${empresaId.slice(0, 8)}` }));
    const [cuenta] = await dbComoEmpresa(empresaId, (tx) =>
      tx
        .insert(cuentasMl)
        .values({
          empresaId,
          cuentaIdExterna: cuentaIdExternaDePrueba(),
          nickname: "VENDEDOR",
          accessTokenCifrado: cifrarToken("access"),
          refreshTokenCifrado: cifrarToken("refresh"),
          tokenExpiraTs: new Date(Date.now() + 3600_000),
        })
        .returning({ id: cuentasMl.id })
    );
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    await expect(cambiarEstadoItemMl(empresaId, cuenta.id, "MCO1/../users/me", true)).rejects.toThrow(/inválido/);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
