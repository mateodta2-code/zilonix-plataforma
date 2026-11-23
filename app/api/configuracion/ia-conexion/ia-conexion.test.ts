import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/headers", () => ({ cookies: vi.fn(() => ({ get: () => undefined })) }));
vi.mock("@/lib/empresas", () => ({ listarEmpresasDeUsuario: vi.fn(async () => [{ id: "11111111-1111-1111-1111-111111111111", nombre: "E" }]) }));
vi.mock("@/lib/usuarios", () => ({ obtenerOCrearUsuarioActual: vi.fn(async () => ({ id: "usuario-1" })) }));
vi.mock("@/lib/permisos", () => {
  class SinPermisoError extends Error {}
  return { requierePermiso: vi.fn(async () => ({})), SinPermisoError };
});
vi.mock("@/lib/url-publica", () => ({ urlPublicaBase: () => "https://staging.test" }));
vi.mock("@/lib/ia/validarUrlBase", () => {
  class UrlBaseIAInvalidaError extends Error {}
  return {
    UrlBaseIAInvalidaError,
    exigirUrlBaseIASegura: vi.fn(async (u: string) => {
      if (u.startsWith("http://")) throw new UrlBaseIAInvalidaError("La URL base debe ser https.");
    }),
  };
});
const modelosMock = vi.hoisted(() => ({ listar: vi.fn(), deConexion: vi.fn() }));
const ia = vi.hoisted(() => ({
  lista: vi.fn(),
  crear: vi.fn(),
  eliminar: vi.fn(),
  principal: vi.fn(),
  modulos: vi.fn(),
  actualizar: vi.fn(),
  porId: vi.fn(),
  llamar: vi.fn(),
}));
vi.mock("@/lib/ia/conexion", async () => {
  const real = await vi.importActual<typeof import("@/lib/ia/conexion")>("@/lib/ia/conexion").catch(() => null);
  class LimiteConexionesIAError extends Error {
    constructor() { super("Puedes conectar hasta 5 IA"); }
  }
  class PrincipalNoEliminableError extends Error {
    constructor() { super("Elige otra IA como principal antes de eliminar esta"); }
  }
  class ConexionIANoEncontradaError extends Error {}
  void real;
  return {
    MENSAJE_LIMITE_IA: "Puedes conectar hasta 5 IA",
    LimiteConexionesIAError,
    PrincipalNoEliminableError,
    ConexionIANoEncontradaError,
    listarConexionesIA: ia.lista,
    crearConexionIA: ia.crear,
    eliminarConexionIA: ia.eliminar,
    marcarPrincipal: ia.principal,
    asignarModulos: ia.modulos,
    actualizarConexionIA: ia.actualizar,
    obtenerConexionIAConClavePorId: ia.porId,
  };
});
vi.mock("@/lib/ia/modelos", async () => {
  const real = await vi.importActual<typeof import("@/lib/ia/modelos")>("@/lib/ia/modelos");
  return { ...real, listarModelosProveedor: modelosMock.listar, listarModelosDeConexion: modelosMock.deConexion };
});
vi.mock("@/lib/ia/proveedores", () => {
  class ErrorProveedorIA extends Error {}
  return { ErrorProveedorIA, llamarIA: ia.llamar };
});

import { requierePermiso, SinPermisoError } from "@/lib/permisos";
import { ConexionIANoEncontradaError, LimiteConexionesIAError, PrincipalNoEliminableError } from "@/lib/ia/conexion";
import { ErrorProveedorIA } from "@/lib/ia/proveedores";
import { DELETE, PUT as PUT_ID } from "./[id]/route";
import { PUT as PUT_MODULOS } from "./[id]/modulos/route";
import { PUT as PUT_PRINCIPAL } from "./[id]/principal/route";
import { POST as POST_PROBAR } from "./[id]/probar/route";
import { POST as POST_MODELOS } from "./modelos/route";
import { GET, POST } from "./route";

const ID = "22222222-2222-2222-2222-222222222222";
const KEY = "clave-de-prueba";
const params = { params: { id: ID } };
function req(metodo: string, cuerpo?: unknown, origin: string | null = "https://staging.test"): Request {
  const headers = new Headers({ "content-type": "application/json" });
  if (origin) headers.set("origin", origin);
  return new Request("https://staging.test/api/configuracion/ia-conexion", { method: metodo, headers, body: cuerpo === undefined ? undefined : JSON.stringify(cuerpo) });
}
const valido = { nombre: "ChatGPT", proveedor: "openai", modelo: "gpt-5", apiKey: KEY };
const fila = { id: ID, nombre: "ChatGPT", proveedor: "openai", baseUrl: null, modelo: "gpt-5", esPrincipal: true, modulos: [], actualizadoTs: new Date() };

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(requierePermiso).mockResolvedValue({} as never);
  ia.lista.mockResolvedValue([fila]);
  ia.crear.mockResolvedValue(fila);
});

describe("API Conectar IA", () => {
  it("GET: lista y mantiene `conexion` (la principal); nunca la key", async () => {
    const res = await GET();
    const texto = await res.text();
    const datos = JSON.parse(texto);
    expect(datos.conexiones).toHaveLength(1);
    expect(datos.conexion.id).toBe(ID);
    expect(texto).not.toContain("apiKey");
    expect(vi.mocked(requierePermiso)).toHaveBeenCalledWith("usuario-1", expect.any(String), "configuracion", "consultar");
  });

  it("sin permiso -> 403 en todas", async () => {
    vi.mocked(requierePermiso).mockRejectedValue(new SinPermisoError("configuracion", "consultar"));
    expect((await GET()).status).toBe(403);
    expect((await POST(req("POST", valido))).status).toBe(403);
    expect((await PUT_ID(req("PUT", valido), params)).status).toBe(403);
    expect((await DELETE(req("DELETE"), params)).status).toBe(403);
    expect((await PUT_PRINCIPAL(req("PUT"), params)).status).toBe(403);
    expect((await PUT_MODULOS(req("PUT", { modulos: [] }), params)).status).toBe(403);
    expect((await POST_PROBAR(req("POST"), params)).status).toBe(403);
  });

  it("origen inválido -> 403", async () => {
    expect((await POST(req("POST", valido, "https://malo.test"))).status).toBe(403);
    expect((await DELETE(req("DELETE", undefined, null), params)).status).toBe(403);
  });

  it("POST crea y no devuelve la key", async () => {
    const res = await POST(req("POST", valido));
    expect(res.status).toBe(201);
    expect(await res.text()).not.toContain(KEY);
  });

  it("POST con 5 conexiones -> 409 sin insertar", async () => {
    ia.lista.mockResolvedValue(Array(5).fill(fila));
    const res = await POST(req("POST", valido));
    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe("Puedes conectar hasta 5 IA");
    expect(ia.crear).not.toHaveBeenCalled();
  });

  it("POST: el error del trigger también es 409", async () => {
    ia.crear.mockRejectedValue(new LimiteConexionesIAError());
    expect((await POST(req("POST", valido))).status).toBe(409);
  });

  it("valida proveedor, modelo, nombre, key y URL insegura -> 400", async () => {
    expect((await POST(req("POST", { ...valido, proveedor: "x" }))).status).toBe(400);
    expect((await POST(req("POST", { ...valido, modelo: "" }))).status).toBe(400);
    expect((await POST(req("POST", { ...valido, nombre: "" }))).status).toBe(400);
    expect((await POST(req("POST", { ...valido, apiKey: "" }))).status).toBe(400);
    expect((await POST(req("POST", { ...valido, nombre: "a".repeat(61) }))).status).toBe(400);
    expect((await POST(req("POST", { ...valido, proveedor: "otro_compatible_openai", baseUrl: "http://10.0.0.1" }))).status).toBe(400);
  });

  it("PUT con key vacía no la cambia; id ajena -> 404; id mal formada -> 404", async () => {
    await PUT_ID(req("PUT", { ...valido, apiKey: "" }), params);
    expect(ia.actualizar.mock.calls[0][3].apiKey).toBeUndefined();
    ia.actualizar.mockRejectedValue(new ConexionIANoEncontradaError());
    expect((await PUT_ID(req("PUT", valido), params)).status).toBe(404);
    expect((await PUT_ID(req("PUT", valido), { params: { id: "no-es-uuid" } })).status).toBe(404);
  });

  it("DELETE: ajena -> 404; principal con otras -> 409", async () => {
    ia.eliminar.mockRejectedValueOnce(new ConexionIANoEncontradaError());
    expect((await DELETE(req("DELETE"), params)).status).toBe(404);
    ia.eliminar.mockRejectedValueOnce(new PrincipalNoEliminableError());
    const res = await DELETE(req("DELETE"), params);
    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe("Elige otra IA como principal antes de eliminar esta");
  });

  it("módulos: inválido -> 400; válido (incluye generacion_imagenes y publicaciones) -> ok", async () => {
    ia.lista.mockResolvedValue([{ ...fila, id: ID, proveedor: "openai" }]);
    expect((await PUT_MODULOS(req("PUT", { modulos: ["inventado"] }), params)).status).toBe(400);
    const res = await PUT_MODULOS(req("PUT", { modulos: ["generacion_imagenes", "publicaciones"] }), params);
    expect(res.status).toBe(200);
    expect(ia.modulos).toHaveBeenCalledWith(expect.any(String), ID, ["generacion_imagenes", "publicaciones"]);
  });

  it("módulos: imágenes en un proveedor que no las genera -> 400 fijo; Google -> 200", async () => {
    for (const proveedor of ["anthropic", "xai", "otro_compatible_openai"]) {
      ia.modulos.mockClear();
      ia.lista.mockResolvedValue([{ ...fila, id: ID, proveedor }]);
      const res = await PUT_MODULOS(req("PUT", { modulos: ["generacion_imagenes"] }), params);
      expect(res.status).toBe(400);
      expect((await res.json()).error).toBe("Esta IA no genera imágenes. Usa una de OpenAI o Google.");
      expect(ia.modulos).not.toHaveBeenCalled();
    }
    ia.lista.mockResolvedValue([{ ...fila, id: ID, proveedor: "google" }]);
    expect((await PUT_MODULOS(req("PUT", { modulos: ["generacion_imagenes"] }), params)).status).toBe(200);
  });

  it("probar: ok, y error del proveedor -> mensaje fijo sin texto crudo ni key", async () => {
    ia.porId.mockResolvedValue({ ...fila, apiKey: KEY });
    ia.llamar.mockResolvedValueOnce("ok");
    expect(await (await POST_PROBAR(req("POST"), params)).json()).toEqual({ ok: true });
    ia.llamar.mockRejectedValueOnce(new ErrorProveedorIA(`OpenAI respondió con error (401). ${KEY} detalle crudo`));
    const texto = await (await POST_PROBAR(req("POST"), params)).text();
    expect(JSON.parse(texto)).toEqual({ ok: false, error: "La llave no es válida o no tiene permiso." });
    expect(texto).not.toContain(KEY);
    expect(texto).not.toContain("crudo");
  });

  it("probar: id ajena -> no encontrada, y límite de 5 por minuto", async () => {
    ia.porId.mockResolvedValue(null);
    expect((await (await POST_PROBAR(req("POST"), params)).json()).error).toBe("No se encontró esa conexión.");
    let ultimo = 0;
    for (let i = 0; i < 6; i++) ultimo = (await POST_PROBAR(req("POST"), params)).status;
    expect(ultimo).toBe(429);
  });

  it("marcar principal responde ok", async () => {
    expect((await PUT_PRINCIPAL(req("PUT"), params)).status).toBe(200);
  });
});

describe("POST /modelos", () => {
  const pedir = (cuerpo: unknown) =>
    POST_MODELOS(new Request("https://staging.test/api/configuracion/ia-conexion/modelos", { method: "POST", headers: { origin: "https://staging.test" }, body: JSON.stringify(cuerpo) }));
  it("sin permiso → 403", async () => {
    vi.mocked(requierePermiso).mockRejectedValueOnce(new SinPermisoError("configuracion", "modificar"));
    expect((await pedir({ proveedor: "openai", apiKey: KEY })).status).toBe(403);
  });
  it("conexionId ajeno → 404", async () => {
    modelosMock.deConexion.mockResolvedValueOnce(null);
    expect((await pedir({ proveedor: "openai", conexionId: ID })).status).toBe(404);
  });
  it("con conexionId usa la clave guardada y no la devuelve", async () => {
    modelosMock.deConexion.mockResolvedValueOnce({ proveedor: "xai", resultado: { ok: true, modelos: ["grok-4.7", "otro"] } });
    const res = await pedir({ proveedor: "openai", conexionId: ID });
    expect(modelosMock.deConexion).toHaveBeenCalledWith(expect.any(String), ID);
    expect(modelosMock.listar).not.toHaveBeenCalled();
    expect(await res.json()).toEqual({ ok: true, modelos: ["grok-4.7", "otro"], recomendado: "grok-4.7" });
  });
  it("con apiKey la usa y el error es un mensaje fijo", async () => {
    modelosMock.listar.mockResolvedValueOnce({ ok: false, error: "clave" });
    const res = await pedir({ proveedor: "openai", apiKey: KEY });
    expect(modelosMock.listar).toHaveBeenCalledWith("openai", KEY);
    const texto = JSON.stringify(await res.json());
    expect(texto).not.toContain(KEY);
    expect(texto).toContain("La API key no es válida");
  });
});
