import { readdirSync, readFileSync } from "fs";
import { join } from "path";
import { beforeEach, describe, expect, it, vi } from "vitest";

// Publicar → «Crear con IA» (PR1). Sin base, sin Mercado Libre y sin IA
// real: se simulan la sesión, el permiso, la cuenta, la conexión y la IA.

const CUENTA = "11111111-1111-1111-1111-111111111111";
const LLAVE = "sk-llave-secreta-de-la-empresa";

const estado = vi.hoisted(() => ({ conPermiso: true, permisosPedidos: [] as string[] }));
const ia = vi.hoisted(() => ({ conexion: vi.fn(), texto: vi.fn(), conImagenes: vi.fn(), descargar: vi.fn() }));
const ml = vi.hoisted(() => ({ categoria: vi.fn(), tendencias: vi.fn(), tituloCompetencia: vi.fn(), masVendidos: vi.fn() }));

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
vi.mock("@/lib/ml/cliente", () => ({ tendenciasPorNivelMl: ml.tendencias, tituloPublicacionMl: ml.tituloCompetencia, titulosMasVendidosMl: ml.masVendidos }));

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
  ml.masVendidos.mockReset().mockResolvedValue({ titulos: [], categoriaId: null });
  ml.tendencias.mockReset().mockResolvedValue({
    ruta: ["Casa", "Cozinha", "Garrafas térmicas"],
    niveles: [
      { nivel: "baja", categoriaId: "MLB1234", nombre: "Garrafas térmicas", palabras: ["garrafa termica"] },
      { nivel: "alta", categoriaId: "MLB1", nombre: "Casa", palabras: ["garrafa", "panela"] },
    ],
  });
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
    expect(r).toMatchObject({ ok: true, titulos: ["Garrafa térmica 1 L"], conTendencias: true, rutaCategoria: ["Casa", "Cozinha", "Garrafas térmicas"] });
    expect(ml.tendencias).toHaveBeenCalledWith("MLB", "MLB1234", "token");
    // Más buscados: sin repetir, de alta a baja, y sin «panela» (de la
    // categoría general, no se relaciona con la garrafa).
    expect(r.ok && r.masBuscados).toEqual([
      { palabra: "garrafa", nivel: "alta" },
      { palabra: "garrafa termica", nivel: "baja" },
    ]);
    expect(r.ok && r.tendenciasSinRelacion).toBe(false);
    // La palabra «garrafa» sale de una tendencia general: nivel alta.
    expect(r.ok && r.palabras.find((p) => p.palabra.toLowerCase() === "garrafa")).toMatchObject({ origen: "tendencia", nivel: "alta" });
  });

  it("competencia: el título del link entra al prompt; si ML no deja leerlo, pide pegarlo; lo pegado manda", async () => {
    ia.texto.mockResolvedValue('{"titulos": ["Garrafa térmica 1 L"], "catalogo": null}');
    ml.tituloCompetencia.mockReset().mockResolvedValue("Garrafa Termica Inox 1 Litro Café");
    const r = await proponerTitulosAction({ cuentaMlId: CUENTA, ficha: FICHA_OK, linkCompetencia: "https://produto.mercadolivre.com.br/MLB-123456789-garrafa" });
    expect(ml.tituloCompetencia).toHaveBeenCalledWith("item", "MLB123456789", "token");
    expect(String(ia.texto.mock.calls.at(-1)?.[1])).toContain("Garrafa Termica Inox 1 Litro Café");
    expect(r.ok && r.competencia).toEqual({ titulo: "Garrafa Termica Inox 1 Litro Café", aviso: null });

    ml.tituloCompetencia.mockResolvedValue(null);
    const sin = await proponerTitulosAction({ cuentaMlId: CUENTA, ficha: FICHA_OK, linkCompetencia: "https://produto.mercadolivre.com.br/MLB-123456789-garrafa" });
    expect(sin.ok && sin.competencia.aviso).toMatch(/Pega su título/);

    ml.tituloCompetencia.mockClear();
    const pegado = await proponerTitulosAction({ cuentaMlId: CUENTA, ficha: FICHA_OK, linkCompetencia: "https://x", tituloCompetencia: "Garrafa pegada" });
    expect(ml.tituloCompetencia).not.toHaveBeenCalled();
    expect(pegado.ok && pegado.competencia.titulo).toBe("Garrafa pegada");
  });

  it("títulos: trae solos los más vendidos de la categoría y se los pasa a la IA", async () => {
    ml.masVendidos.mockResolvedValue({ titulos: ["Garrafa Térmica Inox 1 L Tampa", "Garrafa Café Pressão"], categoriaId: "MLB999" });
    ia.texto.mockResolvedValue('{"titulos": ["Garrafa térmica 1 L"], "catalogo": null}');
    const r = await proponerTitulosAction({ cuentaMlId: CUENTA, ficha: FICHA_OK, categoriaId: "MLB1234", categoriaNombre: "Garrafas térmicas" });
    expect(ml.masVendidos).toHaveBeenCalledWith("MLB", "MLB1234", "token");
    expect(String(ia.texto.mock.calls.at(-1)?.[1])).toContain("- Garrafa Térmica Inox 1 L Tampa");
    // Vinieron de la categoría padre (MLB999 ≠ MLB1234).
    expect(r).toMatchObject({ ok: true, masVendidos: { titulos: ["Garrafa Térmica Inox 1 L Tampa", "Garrafa Café Pressão"], dePadre: true } });
  });

  it("títulos: si los más vendidos fallan, los títulos salen igual", async () => {
    ml.masVendidos.mockRejectedValue(new Error("401"));
    ia.texto.mockResolvedValue('{"titulos": ["Garrafa térmica 1 L"], "catalogo": null}');
    const r = await proponerTitulosAction({ cuentaMlId: CUENTA, ficha: FICHA_OK, categoriaId: "MLB1234" });
    expect(r).toMatchObject({ ok: true, masVendidos: { titulos: [], dePadre: false } });
  });

  it("competencia: un link corto meli.la da un aviso claro, sin llamar a Mercado Libre", async () => {
    ia.texto.mockResolvedValue('{"titulos": ["Garrafa térmica 1 L"], "catalogo": null}');
    const r = await proponerTitulosAction({ cuentaMlId: CUENTA, ficha: FICHA_OK, linkCompetencia: "https://meli.la/2AbCdEf" });
    expect(r.ok && r.competencia.aviso).toMatch(/meli\.la/);
    expect(ml.tituloCompetencia).not.toHaveBeenCalled();
  });

  it("descripción por cuenta: cada versión pide un enfoque distinto; sin variante (o rara) no", async () => {
    ia.texto.mockResolvedValue('{"queEs": "Garrafa térmica de 1 L."}');
    await escribirDescripcionAction({ cuentaMlId: CUENTA, ficha: FICHA_OK, variante: { numero: 1, total: 2 } });
    const uno = String(ia.texto.mock.calls.at(-1)?.[1]);
    await escribirDescripcionAction({ cuentaMlId: CUENTA, ficha: FICHA_OK, variante: { numero: 2, total: 2 } });
    const dos = String(ia.texto.mock.calls.at(-1)?.[1]);
    expect(uno).toContain("versión 1 de 2");
    expect(dos).toContain("versión 2 de 2");
    expect(uno).not.toEqual(dos);
    await escribirDescripcionAction({ cuentaMlId: CUENTA, ficha: FICHA_OK });
    expect(String(ia.texto.mock.calls.at(-1)?.[1])).not.toContain("versión");
    await escribirDescripcionAction({ cuentaMlId: CUENTA, ficha: FICHA_OK, variante: { numero: 5, total: 2 } });
    expect(String(ia.texto.mock.calls.at(-1)?.[1])).not.toContain("versión");
  });

  it("descripción: le pasa a la IA las palabras clave limpias (máximo 20, sin repetir)", async () => {
    ia.texto.mockResolvedValue('{"queEs": "Garrafa térmica de 1 L."}');
    await escribirDescripcionAction({ cuentaMlId: CUENTA, ficha: FICHA_OK, palabrasClave: ["garrafa", "Garrafa", "<script>", 5, "térmica"] });
    const prompt = String(ia.texto.mock.calls.at(-1)?.[1]);
    expect(prompt).toContain("Palabras que la gente busca");
    expect(prompt).toContain("garrafa, script, térmica");
    expect(prompt).not.toContain("<script>");
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
