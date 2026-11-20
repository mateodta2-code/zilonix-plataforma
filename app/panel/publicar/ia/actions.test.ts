import { readdirSync, readFileSync } from "fs";
import { join } from "path";
import { beforeEach, describe, expect, it, vi } from "vitest";

// Publicar → «Crear con IA» (PR1). Sin base, sin Mercado Libre y sin IA
// real: se simulan la sesión, el permiso, la cuenta, la conexión y la IA.

const CUENTA = "11111111-1111-1111-1111-111111111111";
const LLAVE = "sk-llave-secreta-de-la-empresa";

const estado = vi.hoisted(() => ({ conPermiso: true, permisosPedidos: [] as string[] }));
const ia = vi.hoisted(() => ({ conexion: vi.fn(), texto: vi.fn(), conImagenes: vi.fn(), descargar: vi.fn() }));
const ml = vi.hoisted(() => ({ categoria: vi.fn(), tendencias: vi.fn() }));

vi.mock("@/lib/usuarios", () => ({ obtenerOCrearUsuarioActual: async () => ({ id: "usuario-1" }) }));
vi.mock("@/lib/empresas", () => ({ listarEmpresasDeUsuario: async () => [{ id: "empresa-1" }] }));
vi.mock("next/headers", () => ({ cookies: () => ({ get: () => ({ value: "empresa-1" }) }) }));
vi.mock("@/lib/permisos", () => {
  class SinPermisoError extends Error {}
  return {
    SinPermisoError,
    requierePermiso: async (_u: string, _e: string, modulo: string, accion: string) => {
      estado.permisosPedidos.push(`${modulo}.${accion}`);
      if (!estado.conPermiso) throw new SinPermisoError("sin permiso");
    },
  };
});
vi.mock("@/lib/ml/cuentas", () => ({
  listarCuentasConectadas: async () => [{ id: CUENTA, siteId: "MLB", desconectadaTs: null }],
  obtenerAccessTokenVigente: async () => "token",
}));
vi.mock("@/lib/ia/conexion", () => ({ obtenerConexionIAParaModulo: ia.conexion }));
vi.mock("@/lib/ia/imagen", () => ({ descargarFotoBase: ia.descargar }));
vi.mock("@/lib/ia/proveedores", async () => {
  const real = await vi.importActual<typeof import("@/lib/ia/proveedores")>("@/lib/ia/proveedores");
  return { ...real, llamarIA: ia.texto, llamarIAConImagenes: ia.conImagenes };
});
vi.mock("@/lib/ml/publicar", () => ({ resolverCategoria: ml.categoria }));
vi.mock("@/lib/ml/cliente", () => ({ tendenciasCategoriaMl: ml.tendencias }));

import { analizarProductoAction, escribirDescripcionAction, proponerTitulosAction } from "./actions";
import { ErrorProveedorIA } from "@/lib/ia/proveedores";
import { conCupoDeTexto, llamadasDeTextoEnCurso, reiniciarFrenoTexto, MAXIMO_TEXTO_SIMULTANEO_POR_EMPRESA } from "@/lib/publicaciones/freno";

const FICHA_OK = { nombre: { valor: "Garrafa térmica 1 L", origen: "vendedor" }, incluye: { valor: ["Garrafa"], origen: "foto" } };

beforeEach(() => {
  estado.conPermiso = true;
  estado.permisosPedidos = [];
  reiniciarFrenoTexto();
  ia.conexion.mockReset().mockResolvedValue({ id: "c", proveedor: "openai", baseUrl: null, modelo: "m", apiKey: LLAVE });
  ia.texto.mockReset();
  ia.conImagenes.mockReset();
  ia.descargar.mockReset().mockResolvedValue({ buffer: Buffer.from("x"), tipo: "image/jpeg" });
  ml.categoria.mockReset().mockResolvedValue({ categoryId: "MLB1234", categoryName: "Garrafas térmicas", domainName: null });
  ml.tendencias.mockReset().mockResolvedValue(["garrafa termica"]);
});

describe("análisis", () => {
  it("pide el permiso de publicar, usa la IA del módulo Publicaciones y la categoría sale de Mercado Libre", async () => {
    ia.conImagenes.mockResolvedValue(JSON.stringify({ nombre: { valor: "Garrafa térmica", origen: "foto" } }));
    const r = await analizarProductoAction({ cuentaMlId: CUENTA, fotos: ["https://res.cloudinary.com/x/a.jpg"], info: "Garrafa 1 L" });
    expect(r).toMatchObject({ ok: true, idioma: "pt-BR", leyoFotos: true, categoria: { id: "MLB1234", nombre: "Garrafas térmicas" } });
    expect(estado.permisosPedidos).toEqual(["inventario.crear"]);
    expect(ia.conexion).toHaveBeenCalledWith("empresa-1", "publicaciones");
    expect(ia.conImagenes.mock.calls[0][1]).toMatch(/pt-BR/); // idioma por país, nunca es-CO fijo
  });

  it("sin IA conectada: mensaje de Conectar IA y ninguna llamada", async () => {
    ia.conexion.mockResolvedValue(null);
    const r = await analizarProductoAction({ cuentaMlId: CUENTA, info: "Garrafa" });
    expect(r).toMatchObject({ ok: false, conectarIA: true });
    expect(!r.ok && r.aviso).toMatch(/Conectar IA/);
    expect(ia.texto).not.toHaveBeenCalled();
  });

  it("sin permiso o con otra cuenta: no llama a la IA", async () => {
    estado.conPermiso = false;
    expect(await analizarProductoAction({ cuentaMlId: CUENTA, info: "x" })).toMatchObject({ ok: false, aviso: expect.stringMatching(/permiso/) });
    estado.conPermiso = true;
    expect(await analizarProductoAction({ cuentaMlId: "22222222-2222-2222-2222-222222222222", info: "x" })).toMatchObject({ ok: false });
    expect(ia.conexion).not.toHaveBeenCalled();
  });

  it("un error del proveedor llega con un mensaje fijo: nunca el texto crudo ni la llave", async () => {
    ia.texto.mockRejectedValue(new ErrorProveedorIA(`OpenAI respondió con error (401). ${LLAVE}`));
    const r = await analizarProductoAction({ cuentaMlId: CUENTA, info: "Garrafa" });
    expect(r).toEqual({ ok: false, aviso: expect.stringMatching(/rechazó la llave/) });
    expect(JSON.stringify(r)).not.toContain(LLAVE);
  });

  it("sin límite de uso: muchas seguidas siguen funcionando", async () => {
    ia.texto.mockResolvedValue(JSON.stringify({ nombre: { valor: "Garrafa", origen: "vendedor" } }));
    for (let i = 0; i < 40; i++) expect((await analizarProductoAction({ cuentaMlId: CUENTA, info: "Garrafa" })).ok).toBe(true);
  });

  it("freno de concurrencia: máximo 4 a la vez por empresa; las demás esperan y arrancan solas", async () => {
    const liberar: (() => void)[] = [];
    const tarea = () => new Promise<string>((ok) => liberar.push(() => ok("listo")));
    const corriendo = Array.from({ length: 6 }, () => conCupoDeTexto("empresa-1", tarea));
    const otra = conCupoDeTexto("empresa-2", async () => "otra");
    await new Promise((r) => setTimeout(r, 0));
    expect(liberar).toHaveLength(MAXIMO_TEXTO_SIMULTANEO_POR_EMPRESA);
    expect(await otra).toBe("otra"); // el cupo es por empresa
    liberar.shift()!();
    await new Promise((r) => setTimeout(r, 0));
    expect(liberar).toHaveLength(MAXIMO_TEXTO_SIMULTANEO_POR_EMPRESA); // la 5.ª arrancó sola
    while (liberar.length) {
      liberar.shift()!();
      await new Promise((r) => setTimeout(r, 0));
    }
    expect(await Promise.all(corriendo)).toEqual(Array(6).fill("listo"));
    expect(llamadasDeTextoEnCurso("empresa-1")).toBe(0);
  });
});

describe("títulos y descripción", () => {
  it("sin ficha confirmada no se piden (se revisa en el servidor)", async () => {
    const supuesta = { nombre: { valor: "Garrafa", origen: "vendedor" }, capacidad: { valor: "2 L", origen: "supuesto" } };
    expect(await proponerTitulosAction({ cuentaMlId: CUENTA, ficha: supuesta })).toMatchObject({ ok: false, aviso: expect.stringMatching(/Confirma la ficha/) });
    expect(await escribirDescripcionAction({ cuentaMlId: CUENTA, ficha: supuesta })).toMatchObject({ ok: false });
    expect(ia.texto).not.toHaveBeenCalled();
  });

  it("títulos con las tendencias de la categoría de la cuenta", async () => {
    ia.texto.mockResolvedValue('{"titulos": ["Garrafa Térmica 1 L Promoção"], "catalogo": null}');
    const r = await proponerTitulosAction({ cuentaMlId: CUENTA, ficha: FICHA_OK, categoriaId: "MLB1234", categoriaNombre: "Garrafas térmicas" });
    expect(r).toMatchObject({ ok: true, titulos: ["Garrafa térmica 1 L"], conTendencias: true });
    expect(ml.tendencias).toHaveBeenCalledWith("MLB", "MLB1234", "token");
  });

  it("descripción: garantía solo la del vendedor", async () => {
    ia.texto.mockResolvedValue('{"queEs": "Garrafa térmica de 1 L.", "beneficios": ["Garantia de 1 ano"]}');
    const sin = await escribirDescripcionAction({ cuentaMlId: CUENTA, ficha: FICHA_OK });
    expect(sin.ok && sin.descripcion).not.toMatch(/GARANTIA/);
    const con = await escribirDescripcionAction({ cuentaMlId: CUENTA, ficha: FICHA_OK, garantia: "Garantia do vendedor contra defeitos." });
    expect(con.ok && con.descripcion).toContain("GARANTIA\nGarantia do vendedor contra defeitos.");
  });
});

describe("nunca la IA de la plataforma", () => {
  it("el código nuevo no lee ANTHROPIC_API_KEY", () => {
    const raiz = process.cwd();
    const archivos = [
      ...readdirSync(join(raiz, "lib/publicaciones")).map((a) => join(raiz, "lib/publicaciones", a)),
      join(raiz, "app/panel/publicar/ia/actions.ts"),
      join(raiz, "app/panel/publicar/ia/imagenes/actions.ts"),
      join(raiz, "app/panel/publicar/CrearConIA.tsx"),
      join(raiz, "app/panel/publicar/GenerarConIA.tsx"),
      ...readdirSync(join(raiz, "lib/ia/prompts")).filter((a) => a.endsWith(".ts")).map((a) => join(raiz, "lib/ia/prompts", a)),
    ].filter((a) => !a.endsWith(".test.ts"));
    for (const a of archivos) expect(readFileSync(a, "utf8"), a).not.toMatch(/ANTHROPIC_API_KEY|process\.env/);
  });
});
