import { describe, expect, it, vi } from "vitest";

// Code review de Pablo (origin/main...mateo/feat-publicar-ux, punto 2)
// sobre las 3 rutas de categoría/características: validación de
// formato ANTES de tocar la base/Mercado Libre, SinPermisoError nunca
// burbujea a 500, y error.message nunca se devuelve crudo. Pruebas
// puras — sin DB, sin fetch, mismo criterio que lib/ml/publicar-reglas.test.ts.
//
// @/lib/permisos y @/lib/ml/cuentas importan (transitivo) db/index.ts,
// que revienta sin DATABASE_URL_APP — mismo motivo exacto por el que
// app/api/ml/clip/route.test.ts mockea estos dos módulos en vez de
// importarlos reales. Se redefinen las clases de error con la MISMA
// forma real (mismo nombre, mismo constructor) — _ayudantes.ts importa
// de estos mismos módulos mockeados, así que el "instanceof" sigue
// funcionando igual que contra las clases reales. @/lib/ml/cliente SÍ
// se importa real: no tiene ningún import de db/.
vi.mock("@/lib/permisos", () => {
  class SinPermisoError extends Error {
    constructor(modulo: string, accion: string) {
      super(`No tienes permiso para "${accion}" en "${modulo}".`);
      this.name = "SinPermisoError";
    }
  }
  return { SinPermisoError };
});
vi.mock("@/lib/ml/cuentas", () => {
  class CuentaMlNoEncontradaError extends Error {
    constructor() {
      super("No se encontró esa cuenta de Mercado Libre.");
      this.name = "CuentaMlNoEncontradaError";
    }
  }
  class CuentaDesconectadaError extends Error {
    constructor() {
      super("Esta cuenta de Mercado Libre está desconectada — hay que reconectarla.");
      this.name = "CuentaDesconectadaError";
    }
  }
  class CandadoDeRenovacionError extends Error {
    constructor() {
      super("Otro proceso ya está renovando el token de esta cuenta — reintentar en unos segundos.");
      this.name = "CandadoDeRenovacionError";
    }
  }
  class RenovacionTokenFallidaError extends Error {
    constructor() {
      super("No se pudo renovar la conexión con Mercado Libre — puede que haya que reconectar la cuenta.");
      this.name = "RenovacionTokenFallidaError";
    }
  }
  return { CuentaMlNoEncontradaError, CuentaDesconectadaError, CandadoDeRenovacionError, RenovacionTokenFallidaError };
});

import { SinPermisoError } from "@/lib/permisos";
import { CandadoDeRenovacionError, CuentaDesconectadaError, CuentaMlNoEncontradaError, RenovacionTokenFallidaError } from "@/lib/ml/cuentas";
import { LimiteMercadoLibreError, MlNoAutorizadoError, MlNoDisponibleError, MlRespuestaInesperadaError, MlSinPermisoAppError, PATRON_ID_CATEGORIA } from "@/lib/ml/cliente";
import { respuestaDeErrorMl, respuestaSiCategoryIdInvalido, respuestaSiCuentaIdInvalido, respuestaSiSinPermiso } from "./_ayudantes";

describe("respuestaSiCuentaIdInvalido — ADENDO UX de Publicar, revisión", () => {
  it("UUID real: null (sin bloquear)", () => {
    expect(respuestaSiCuentaIdInvalido("a1b2c3d4-e5f6-7890-abcd-ef1234567890")).toBeNull();
  });

  it("vacío/ausente: 400, nunca llega a tocar la base", async () => {
    const res = respuestaSiCuentaIdInvalido(null);
    expect(res).not.toBeNull();
    expect(res!.status).toBe(400);
    expect((await res!.json()).error).toMatch(/cuentaId/i);
  });

  it("formato no-UUID (ej. un id corto o inyección): 400", async () => {
    const res = respuestaSiCuentaIdInvalido("no-es-un-uuid-real");
    expect(res!.status).toBe(400);
  });
});

describe("respuestaSiCategoryIdInvalido — ADENDO UX de Publicar, revisión", () => {
  it("categoryId real (MCOxxxx): null", () => {
    expect(respuestaSiCategoryIdInvalido("MCO1234", PATRON_ID_CATEGORIA)).toBeNull();
  });

  it("ausente/vacío: null — estas rutas aceptan sin categoryId (detección automática)", () => {
    expect(respuestaSiCategoryIdInvalido(null, PATRON_ID_CATEGORIA)).toBeNull();
    expect(respuestaSiCategoryIdInvalido("", PATRON_ID_CATEGORIA)).toBeNull();
  });

  it("formato inválido: 400", async () => {
    const res = respuestaSiCategoryIdInvalido("MLA123", PATRON_ID_CATEGORIA); // prefijo de otro país, fuera de alcance (solo MCO)
    expect(res).not.toBeNull();
    expect(res!.status).toBe(400);
    expect((await res!.json()).error).toMatch(/categoryId/i);
  });
});

describe("respuestaSiSinPermiso — SinPermisoError nunca burbujea a 500", () => {
  it("SinPermisoError -> 403 JSON claro", async () => {
    const res = respuestaSiSinPermiso(new SinPermisoError("inventario" as never, "crear" as never));
    expect(res).not.toBeNull();
    expect(res!.status).toBe(403);
    expect((await res!.json()).error).toBeTruthy();
  });

  it("cualquier otro error -> null (el llamador lo relanza, nunca lo traga)", () => {
    expect(respuestaSiSinPermiso(new Error("otra cosa"))).toBeNull();
  });
});

describe("respuestaDeErrorMl — nunca error.message crudo, mapeo por instanceof (code review de Pablo)", () => {
  it("CuentaMlNoEncontradaError -> 404", () => {
    expect(respuestaDeErrorMl(new CuentaMlNoEncontradaError()).status).toBe(404);
  });

  it("CuentaDesconectadaError -> 409", () => {
    expect(respuestaDeErrorMl(new CuentaDesconectadaError()).status).toBe(409);
  });

  it("CandadoDeRenovacionError -> 409", () => {
    expect(respuestaDeErrorMl(new CandadoDeRenovacionError()).status).toBe(409);
  });

  it("RenovacionTokenFallidaError -> 409", () => {
    expect(respuestaDeErrorMl(new RenovacionTokenFallidaError()).status).toBe(409);
  });

  it("MlNoAutorizadoError -> 409 (hay que reconectar)", () => {
    expect(respuestaDeErrorMl(new MlNoAutorizadoError()).status).toBe(409);
  });

  it("LimiteMercadoLibreError -> 429", () => {
    expect(respuestaDeErrorMl(new LimiteMercadoLibreError()).status).toBe(429);
  });

  it("MlSinPermisoAppError/MlNoDisponibleError/MlRespuestaInesperadaError -> 502, mensaje fijo", () => {
    for (const error of [new MlSinPermisoAppError("/x"), new MlNoDisponibleError(), new MlRespuestaInesperadaError(418, "hacer algo")]) {
      expect(respuestaDeErrorMl(error).status).toBe(502);
    }
  });

  // BLOQUEANTE evitado: antes esta ruta devolvía error.message tal
  // cual — un Error cualquiera (ej. de una excepción no anticipada)
  // nunca debe llegar a la respuesta.
  it("Error genérico (ni tipado ni conocido): 502 con mensaje FIJO, nunca el texto original de la excepción", async () => {
    const detalleSensible = "DETALLE_INTERNO_QUE_NUNCA_TIENE_QUE_LLEGAR_AL_CLIENTE_98765";
    const res = respuestaDeErrorMl(new Error(detalleSensible));
    expect(res.status).toBe(502);
    const cuerpo = await res.json();
    expect(cuerpo.error).not.toContain(detalleSensible);
  });

  it("un new Error(...) propio de lib/ml/publicar.ts (ej. categoría no encontrada) también cae al fallback genérico — no hay forma de distinguirlo de uno inesperado solo por instanceof Error", async () => {
    const res = respuestaDeErrorMl(new Error('Mercado Libre no encontró categoría para "algo" en MCO.'));
    expect(res.status).toBe(502);
    const cuerpo = await res.json();
    expect(cuerpo.error).not.toContain("algo");
  });

  it("valor que no es ni Error (ej. un string lanzado a mano): 502 sin lanzar", () => {
    expect(respuestaDeErrorMl("texto cualquiera").status).toBe(502);
  });
});
