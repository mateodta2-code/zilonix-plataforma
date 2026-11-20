import { beforeEach, describe, expect, it, vi } from "vitest";

const ia = vi.hoisted(() => ({ texto: vi.fn(), conImagenes: vi.fn() }));
vi.mock("@/lib/ia/proveedores", async () => {
  const real = await vi.importActual<typeof import("@/lib/ia/proveedores")>("@/lib/ia/proveedores");
  return { ...real, llamarIA: ia.texto, llamarIAConImagenes: ia.conImagenes };
});

import { analizarProducto, ErrorAnalisisIA, promptAnalisis } from "@/lib/publicaciones/analisis";
import { ErrorIASinVision } from "@/lib/ia/proveedores";
import type { ConexionIAConClave } from "@/lib/ia/tipos";

const CONEXION = { id: "c", proveedor: "openai", baseUrl: null, modelo: "m", apiKey: "k" } as unknown as ConexionIAConClave;
const FOTO = { mediaType: "image/jpeg" as const, base64: "eA==" };
const RESPUESTA = JSON.stringify({ nombre: { valor: "Termo de acero", origen: "foto" }, color: { valor: "N/A", origen: "foto" } });

beforeEach(() => {
  ia.texto.mockReset();
  ia.conImagenes.mockReset();
});

describe("análisis del producto", () => {
  it("con fotos usa la IA con imágenes y devuelve la ficha limpia", async () => {
    ia.conImagenes.mockResolvedValue(RESPUESTA);
    const r = await analizarProducto(CONEXION, { idioma: "pt-BR", pais: "Brasil", info: "Termo 1 L", fotos: [FOTO] });
    expect(r.leyoFotos).toBe(true);
    expect(r.ficha.nombre.valor).toBe("Termo de acero");
    expect(r.ficha.color.valor).toBeNull();
    expect(ia.conImagenes.mock.calls[0][1]).toMatch(/TODO en pt-BR/);
    expect(ia.texto).not.toHaveBeenCalled();
  });

  it("si el modelo no lee imágenes, repite solo con el texto del vendedor", async () => {
    ia.conImagenes.mockRejectedValue(new ErrorIASinVision("no acepta (400)."));
    ia.texto.mockResolvedValue(RESPUESTA);
    const r = await analizarProducto(CONEXION, { idioma: "es-MX", pais: "México", info: "Termo", fotos: [FOTO] });
    expect(r.leyoFotos).toBe(false);
    expect(ia.texto).toHaveBeenCalledTimes(1);
  });

  it("JSON inválido o sin nombre → error amable (nunca el texto crudo)", async () => {
    ia.texto.mockResolvedValue("lo siento, no puedo");
    await expect(analizarProducto(CONEXION, { idioma: "es-CO", pais: "Colombia", info: "x", fotos: [] })).rejects.toBeInstanceOf(ErrorAnalisisIA);
    ia.texto.mockResolvedValue(JSON.stringify({ color: { valor: "Rojo", origen: "foto" } }));
    await expect(analizarProducto(CONEXION, { idioma: "es-CO", pais: "Colombia", info: "x", fotos: [] })).rejects.toThrow(/no reconoció el producto/);
  });

  it("el pedido prohíbe inventar y «N/A», y pide origen por campo", () => {
    const p = promptAnalisis({ idioma: "es-AR", pais: "Argentina", info: "Termo", conFotos: false });
    expect(p).toMatch(/Mercado Libre Argentina/);
    expect(p).toMatch(/Nunca escribas «N\/A»/);
    expect(p).toMatch(/"origen": "foto" \| "vendedor" \| "supuesto"/);
  });
});
