import { beforeEach, describe, expect, it, vi } from "vitest";

// "Actualizar ahora" (14-nov) — la acción DEVUELVE el aviso en vez de
// redirigir con ?aviso=: en staging el aviso no aparecía al terminar.
// Sin base: se simulan la sesión, la empresa, el permiso y el trabajo.

const estado = vi.hoisted(() => ({ conPermiso: true }));
const refrescar = vi.hoisted(() => vi.fn());

vi.mock("@/lib/usuarios", () => ({ obtenerOCrearUsuarioActual: async () => ({ id: "usuario-1" }) }));
vi.mock("@/lib/empresas", () => ({ listarEmpresasDeUsuario: async () => [{ id: "empresa-1" }] }));
vi.mock("next/headers", () => ({ cookies: () => ({ get: () => ({ value: "empresa-1" }) }) }));
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw new Error(`REDIRECT:${url}`);
  },
}));
vi.mock("@/lib/permisos", () => {
  class SinPermisoError extends Error {}
  return {
    SinPermisoError,
    requierePermiso: async () => {
      if (!estado.conPermiso) throw new SinPermisoError("sin permiso");
    },
  };
});
vi.mock("@/lib/trabajos/sincronizarPublicidad", () => ({ refrescarPublicidadManual: refrescar }));
// Meta de margen: se simula la escritura en configuracion_finanzas.
const escrituras = vi.hoisted(() => [] as unknown[]);
vi.mock("@/db/empresa-context", () => ({
  dbComoEmpresa: async (empresaId: string, fn: (tx: unknown) => Promise<unknown>) =>
    fn({
      insert: () => ({
        values: (valores: unknown) => ({
          onConflictDoUpdate: async (conflicto: { set: unknown }) => {
            escrituras.push({ empresaId, valores, set: conflicto.set });
          },
        }),
      }),
    }),
}));

import { AVISO_REFRESCO_FALLIDO } from "@/lib/publicidad/plan";
import { actualizarPublicidadAction, guardarMetaMargenAction } from "./actions";

const CUENTA = "11111111-1111-1111-1111-111111111111";

function formulario(cuentaMlId: string): FormData {
  const datos = new FormData();
  datos.set("cuentaMlId", cuentaMlId);
  return datos;
}

describe("actualizarPublicidadAction devuelve el aviso, no redirige", () => {
  beforeEach(() => {
    estado.conPermiso = true;
    refrescar.mockReset();
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  it("devuelve el aviso del trabajo tal cual", async () => {
    refrescar.mockResolvedValue({ ok: true, aviso: "Publicidad actualizada." });
    await expect(actualizarPublicidadAction(formulario(CUENTA))).resolves.toEqual({ ok: true, aviso: "Publicidad actualizada." });
    expect(refrescar).toHaveBeenCalledWith("empresa-1", CUENTA, "usuario-1");
  });

  it("una actualización a medias llega marcada como incompleta (amarillo, no verde)", async () => {
    refrescar.mockResolvedValue({ ok: true, aviso: "Se guardó una parte.", incompleta: true });
    await expect(actualizarPublicidadAction(formulario(CUENTA))).resolves.toEqual({ ok: true, aviso: "Se guardó una parte.", incompleta: true });
  });

  it("sin permiso o sin cuenta válida avisa y no llama a Mercado Libre", async () => {
    estado.conPermiso = false;
    await expect(actualizarPublicidadAction(formulario(CUENTA))).resolves.toMatchObject({ ok: false, aviso: expect.stringMatching(/permiso/) });
    estado.conPermiso = true;
    await expect(actualizarPublicidadAction(formulario("no-es-uuid"))).resolves.toMatchObject({ ok: false, aviso: expect.stringMatching(/Elegí una cuenta/) });
    expect(refrescar).not.toHaveBeenCalled();
  });

  it("un error inesperado devuelve el aviso fijo, nunca el texto crudo", async () => {
    refrescar.mockRejectedValue(new Error("connect postgres://usuario:secreto@host/base"));
    const resultado = await actualizarPublicidadAction(formulario(CUENTA));
    expect(resultado).toEqual({ ok: false, aviso: AVISO_REFRESCO_FALLIDO });
  });
});

describe("guardarMetaMargenAction (semáforo de productos)", () => {
  const meta = (valor: string) => {
    const datos = new FormData();
    datos.set("meta", valor);
    return datos;
  };

  beforeEach(() => {
    estado.conPermiso = true;
    escrituras.length = 0;
  });

  it("guarda la meta en fracción para la empresa activa", async () => {
    await expect(guardarMetaMargenAction(meta("25"))).resolves.toMatchObject({ ok: true });
    expect(escrituras).toEqual([
      expect.objectContaining({
        empresaId: "empresa-1",
        valores: expect.objectContaining({ empresaId: "empresa-1", metaMargenPublicidad: "0.2500", actualizadaPor: "usuario-1" }),
        set: expect.objectContaining({ metaMargenPublicidad: "0.2500" }),
      }),
    ]);
  });

  it("sin permiso de modificar Publicidad no guarda nada", async () => {
    estado.conPermiso = false;
    await expect(guardarMetaMargenAction(meta("25"))).resolves.toMatchObject({ ok: false, aviso: expect.stringMatching(/permiso/) });
    expect(escrituras).toEqual([]);
  });

  it("un valor fuera de 1 a 99 no se guarda", async () => {
    await expect(guardarMetaMargenAction(meta("150"))).resolves.toMatchObject({ ok: false, aviso: expect.stringMatching(/entre 1 y 99/) });
    expect(escrituras).toEqual([]);
  });
});
