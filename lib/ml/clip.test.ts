import { randomUUID } from "crypto";
import { mkdtempSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import path from "path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { dbComoEmpresa } from "@/db/empresa-context";
import { cuentasMl, empresas } from "@/db/schema";
import { cifrarToken } from "@/lib/cifrado";
import {
  buscarItemPorSku,
  buscarSkuEnTodasLasCuentas,
  ClipInvalidoError,
  MENSAJES_PROBLEMA_VIDEO_CLIP,
  problemasDeVideoClip,
  subirClipItemDesdeArchivo,
  TAMANO_MAXIMO_CLIP_BYTES,
  validarArchivoClip,
} from "./clip";

function jsonRes(status: number, data: unknown): Response {
  return { ok: status >= 200 && status < 300, status, json: async () => data, text: async () => JSON.stringify(data) } as Response;
}

// Tarea 2.11, punto 3: cuentaIdExterna tiene que cumplir /^\d+$/
// (mismo patrón de cliente.ts) — buscarItemPorSku() ahora pasa por
// buscarItemsPorSkuMl(), que valida ANTES de armar la URL. El fixture
// viejo ("ml-user-clip-xxxxxxxx") nunca iba a pasar esa validación.
function cuentaIdExternaDePrueba(): string {
  return `${Date.now()}${Math.floor(Math.random() * 10_000)}`;
}

async function crearEmpresaYCuenta() {
  const empresaId = randomUUID();
  await dbComoEmpresa(empresaId, (tx) => tx.insert(empresas).values({ id: empresaId, nombre: "Empresa clip", nit: `TEST-CLIP-${empresaId.slice(0, 8)}` }));
  const [cuenta] = await dbComoEmpresa(empresaId, (tx) =>
    tx
      .insert(cuentasMl)
      .values({
        empresaId,
        cuentaIdExterna: cuentaIdExternaDePrueba(),
        nickname: "VENDEDOR_CLIP",
        accessTokenCifrado: cifrarToken("access"),
        refreshTokenCifrado: cifrarToken("refresh"),
        tokenExpiraTs: new Date(Date.now() + 3600_000),
      })
      .returning({ id: cuentasMl.id, cuentaIdExterna: cuentasMl.cuentaIdExterna })
  );
  return { empresaId, cuenta };
}

describe("buscarItemPorSku (tarea 2.11, §10) — búsqueda real por seller_sku, sin descargar el catálogo completo", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("encuentra el item por SKU real", async () => {
    const { empresaId, cuenta } = await crearEmpresaYCuenta();
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: unknown) => {
        const u = String(url);
        if (u.includes("/items/search")) return jsonRes(200, { results: ["MCO999"] });
        if (u.includes("/items/MCO999")) return jsonRes(200, { id: "MCO999", title: "Producto encontrado", thumbnail: "https://x/thumb.jpg" });
        throw new Error(`no mockeado: ${u}`);
      })
    );
    const r = await buscarItemPorSku(empresaId, cuenta, "SKU-REAL");
    expect(r?.itemId).toBe("MCO999");
    expect(r?.titulo).toBe("Producto encontrado");
  });

  it("sin coincidencias, devuelve null", async () => {
    const { empresaId, cuenta } = await crearEmpresaYCuenta();
    vi.stubGlobal("fetch", vi.fn(async () => jsonRes(200, { results: [] })));
    const r = await buscarItemPorSku(empresaId, cuenta, "SKU-INEXISTENTE");
    expect(r).toBeNull();
  });

  // Tarea 2.11, punto 3 — "si no cumple, error claro y nunca se llama
  // a ML". cuenta.cuentaIdExterna no tiene por qué ser confiable al
  // 100% (viene de la base, pero nada impide que una fila vieja/rota
  // tenga un valor raro) — se valida igual, nunca se asume bien
  // formado solo porque viene de Postgres.
  it("cuentaIdExterna que no cumple /^\\d+$/ nunca llama a fetch", async () => {
    const { empresaId, cuenta } = await crearEmpresaYCuenta();
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    await expect(buscarItemPorSku(empresaId, { ...cuenta, cuentaIdExterna: "MCO1/../users/me" }, "SKU")).rejects.toThrow(/inválido/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("un itemId que Mercado Libre devuelve con forma inválida nunca llama a la segunda URL", async () => {
    const { empresaId, cuenta } = await crearEmpresaYCuenta();
    const fetchMock = vi.fn(async (url: unknown) => {
      const u = String(url);
      if (u.includes("/items/search")) return jsonRes(200, { results: ["MCO1/../users/me"] });
      throw new Error(`no debía llegar hasta acá: ${u}`);
    });
    vi.stubGlobal("fetch", fetchMock);
    await expect(buscarItemPorSku(empresaId, cuenta, "SKU-RARO")).rejects.toThrow(/inválido/);
    expect(fetchMock).toHaveBeenCalledTimes(1); // solo la búsqueda por SKU — nunca la segunda llamada
  });
});

describe("buscarSkuEnTodasLasCuentas (rama feat-publicar-clip, punto 3) — busca en TODAS las cuentas en paralelo, una cuenta que falla no tira abajo las demás", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("una cuenta encuentra el SKU (activa), otra no lo tiene, una tercera da un error real de red — las 3 filas vuelven, cada una con su motivo real", async () => {
    const { empresaId, cuenta: cuentaA } = await crearEmpresaYCuenta();
    const { cuenta: cuentaB } = await crearEmpresaYCuenta();
    const { cuenta: cuentaC } = await crearEmpresaYCuenta();
    const cuentas = [
      { id: cuentaA.id, nickname: "Cuenta A", cuentaIdExterna: cuentaA.cuentaIdExterna },
      { id: cuentaB.id, nickname: "Cuenta B", cuentaIdExterna: cuentaB.cuentaIdExterna },
      { id: cuentaC.id, nickname: "Cuenta C", cuentaIdExterna: cuentaC.cuentaIdExterna },
    ];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: unknown) => {
        const u = String(url);
        if (u.includes(`/users/${cuentaA.cuentaIdExterna}/items/search`)) return jsonRes(200, { results: ["MCO999"] });
        if (u.includes("/items/MCO999")) return jsonRes(200, { id: "MCO999", title: "Encontrado", thumbnail: "https://x/thumb.jpg", status: "active" });
        if (u.includes(`/users/${cuentaB.cuentaIdExterna}/items/search`)) return jsonRes(200, { results: [] });
        if (u.includes(`/users/${cuentaC.cuentaIdExterna}/items/search`)) return { ok: false, status: 500, text: async () => "" } as Response;
        throw new Error(`no mockeado: ${u}`);
      })
    );
    const filas = await buscarSkuEnTodasLasCuentas(empresaId, cuentas, "SKU-COMPARTIDO");
    expect(filas).toHaveLength(3);
    const filaA = filas.find((f) => f.cuentaId === cuentaA.id);
    const filaB = filas.find((f) => f.cuentaId === cuentaB.id);
    const filaC = filas.find((f) => f.cuentaId === cuentaC.id);
    expect(filaA).toMatchObject({ encontrado: true, itemId: "MCO999", activo: true, motivoNoDisponible: null });
    expect(filaB).toMatchObject({ encontrado: false, motivoNoDisponible: expect.stringContaining("Sin ese SKU") });
    expect(filaC?.encontrado).toBe(false);
    expect(filaC?.motivoNoDisponible).toBeTruthy(); // el motivo real del error, nunca vacío ni silencioso
  });

  it("el SKU se encuentra pero la publicación está pausada: activo=false, con el motivo real para no ofrecerla marcada", async () => {
    const { empresaId, cuenta } = await crearEmpresaYCuenta();
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: unknown) => {
        const u = String(url);
        if (u.includes("/items/search")) return jsonRes(200, { results: ["MCO999"] });
        if (u.includes("/items/MCO999")) return jsonRes(200, { id: "MCO999", title: "Pausada", status: "paused" });
        throw new Error(`no mockeado: ${u}`);
      })
    );
    const [fila] = await buscarSkuEnTodasLasCuentas(empresaId, [{ id: cuenta.id, nickname: "Cuenta", cuentaIdExterna: cuenta.cuentaIdExterna }], "SKU");
    expect(fila.encontrado).toBe(true);
    expect(fila.activo).toBe(false);
    expect(fila.motivoNoDisponible).toContain("paused");
  });

  it("sin cuentas: [], nunca lanza", async () => {
    const { empresaId } = await crearEmpresaYCuenta();
    await expect(buscarSkuEnTodasLasCuentas(empresaId, [], "SKU")).resolves.toEqual([]);
  });
});

describe("subirClipItemDesdeArchivo (rama feat-publicar-clip) — mismo endpoint, ahora leyendo de un archivo temporal por streaming (fs.openAsBlob), nunca un Buffer en memoria", () => {
  let carpetaTemporal: string;
  let rutaArchivo: string;

  afterEach(() => {
    vi.unstubAllGlobals();
    rmSync(carpetaTemporal, { recursive: true, force: true });
  });

  function archivoDePrueba(contenido = "contenido de video de prueba"): string {
    carpetaTemporal = mkdtempSync(path.join(tmpdir(), "zilonix-clip-test-"));
    rutaArchivo = path.join(carpetaTemporal, "clip.mp4");
    writeFileSync(rutaArchivo, contenido);
    return rutaArchivo;
  }

  it("sube el video (leído del archivo por streaming) y devuelve el estado de moderación", async () => {
    const ruta = archivoDePrueba();
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: unknown, init?: RequestInit) => {
        // El body tiene que seguir siendo FormData — nunca un buffer
        // crudo — mismo contrato real de Mercado Libre.
        expect(init?.body).toBeInstanceOf(FormData);
        return jsonRes(200, { status: "accepted", clip_uuid: "abc-123", site_ids: ["MCO"] });
      })
    );
    const r = await subirClipItemDesdeArchivo("token", "MCO111", ruta, "clip.mp4", "video/mp4");
    expect(r.status).toBe("accepted");
    expect(r.clipUuid).toBe("abc-123");
  });

  it("avisa claro cuando la cuenta no tiene reputación todavía (Mateo, 28/9, FullyLemon)", async () => {
    const ruta = archivoDePrueba();
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, status: 403, text: async () => "PA_UNAUTHORIZED_RESULT_FROM_POLICIES" }) as Response));
    await expect(subirClipItemDesdeArchivo("token", "MCO111", ruta, "clip.mp4", "video/mp4")).rejects.toThrow(/color de reputación/);
  });

  // Tarea 2.11, punto 3 — itemId viene de formData/JSON (app/api/ml/clip/
  // route.ts) — nunca confiado sin validar.
  it("itemId inválido nunca llama a fetch", async () => {
    const ruta = archivoDePrueba();
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    await expect(subirClipItemDesdeArchivo("token", "MCO1/../users/me", ruta, "clip.mp4", "video/mp4")).rejects.toThrow(/inválido/);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("problemasDeVideoClip — Parte Clip, punto 2 (revisión antes de subir, en el navegador)", () => {
  const VALIDO: Parameters<typeof problemasDeVideoClip>[0] = { duracionSegundos: 30, ancho: 480, alto: 854, tamanoBytes: 10 * 1024 * 1024 };

  it("video válido real: sin ningún problema", () => {
    expect(problemasDeVideoClip(VALIDO)).toEqual([]);
  });

  it("menos de 10 segundos: duracion_corta", () => {
    expect(problemasDeVideoClip({ ...VALIDO, duracionSegundos: 5 })).toEqual(["duracion_corta"]);
  });

  it("más de 61 segundos: duracion_larga", () => {
    expect(problemasDeVideoClip({ ...VALIDO, duracionSegundos: 90 })).toEqual(["duracion_larga"]);
  });

  it("horizontal (ancho >= alto): no_vertical", () => {
    expect(problemasDeVideoClip({ ...VALIDO, ancho: 854, alto: 480 })).toEqual(["no_vertical"]);
  });

  it("por debajo de 360x640: resolucion_baja", () => {
    expect(problemasDeVideoClip({ ...VALIDO, ancho: 200, alto: 400 })).toEqual(["resolucion_baja"]);
  });

  it("más de 280MB: demasiado_grande", () => {
    expect(problemasDeVideoClip({ ...VALIDO, tamanoBytes: TAMANO_MAXIMO_CLIP_BYTES + 1 })).toEqual(["demasiado_grande"]);
  });

  it("varios problemas a la vez: devuelve TODOS, nunca solo el primero", () => {
    const problemas = problemasDeVideoClip({ duracionSegundos: 5, ancho: 854, alto: 480, tamanoBytes: TAMANO_MAXIMO_CLIP_BYTES + 1 });
    expect(problemas).toEqual(expect.arrayContaining(["duracion_corta", "no_vertical", "demasiado_grande"]));
    expect(problemas).toHaveLength(3);
  });

  it("cada problema tiene un mensaje real propio, nunca un texto genérico repetido", () => {
    const mensajes = new Set(Object.values(MENSAJES_PROBLEMA_VIDEO_CLIP));
    expect(mensajes.size).toBe(Object.keys(MENSAJES_PROBLEMA_VIDEO_CLIP).length);
  });
});

describe("validarArchivoClip — requisitos reales documentados por Mercado Libre, nunca validados en el sistema actual", () => {
  it("rechaza un tipo de archivo que no es video", () => {
    expect(() => validarArchivoClip("image/png", 1000)).toThrow(ClipInvalidoError);
  });
  it("rechaza un video de más de 280MB", () => {
    expect(() => validarArchivoClip("video/mp4", 300 * 1024 * 1024)).toThrow(ClipInvalidoError);
  });
  it("acepta un MP4 dentro del tamaño real", () => {
    expect(() => validarArchivoClip("video/mp4", 10 * 1024 * 1024)).not.toThrow();
  });
});
