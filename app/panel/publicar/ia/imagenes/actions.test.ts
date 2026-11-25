import { beforeEach, describe, expect, it, vi } from "vitest";

// Publicar → «Generar con IA» (PR2). Sin base, sin Mercado Libre y sin
// IA real: se simulan la sesión, el permiso, las cuentas, la conexión, la
// cola, la IA y Cloudinary.

const C1 = "11111111-1111-1111-1111-111111111111";
const C2 = "22222222-2222-2222-2222-222222222222";
const C3 = "33333333-3333-3333-3333-333333333333";
const IMG = "44444444-4444-4444-4444-444444444444";
const LLAVE = "sk-llave-secreta-de-la-empresa";

const estado = vi.hoisted(() => ({ conPermiso: true }));
const ia = vi.hoisted(() => ({ conexion: vi.fn(), texto: vi.fn(), generar: vi.fn(), descargar: vi.fn(), subir: vi.fn() }));
const cola = vi.hoisted(() => ({ crearTrabajo: vi.fn(), crearImagenes: vi.fn(), leerImagen: vi.fn(), leerTrabajo: vi.fn(), actualizar: vi.fn(), cupo: vi.fn(), terminar: vi.fn() }));
const ml = vi.hoisted(() => ({ diagnostico: vi.fn() }));

vi.mock("@/lib/usuarios", () => ({ obtenerOCrearUsuarioActual: async () => ({ id: "usuario-1" }) }));
vi.mock("@/lib/empresas", () => ({ listarEmpresasDeUsuario: async () => [{ id: "empresa-1" }] }));
vi.mock("next/headers", () => ({ cookies: () => ({ get: () => ({ value: "empresa-1" }) }) }));
vi.mock("@/lib/permisos", () => {
  class SinPermisoError extends Error {}
  return {
    SinPermisoError,
    requierePermiso: async () => {
      if (!estado.conPermiso) throw new SinPermisoError("sin permiso");
    },
  };
});
vi.mock("@/lib/ml/cuentas", () => ({
  listarCuentasConectadas: async () => [
    { id: C1, nickname: "TIENDA1", siteId: "MCO", desconectadaTs: null },
    { id: C2, nickname: "TIENDA2", siteId: "MCO", desconectadaTs: null },
    { id: C3, nickname: "TIENDA3", siteId: "MCO", desconectadaTs: null },
  ],
  obtenerAccessTokenVigente: async () => "token",
}));
vi.mock("@/lib/ia/conexion", () => ({ obtenerConexionIAParaModulo: ia.conexion }));
vi.mock("@/lib/ia/proveedores", async () => {
  const real = await vi.importActual<typeof import("@/lib/ia/proveedores")>("@/lib/ia/proveedores");
  return { ...real, llamarIA: ia.texto };
});
vi.mock("@/lib/ia/imagen", async () => {
  const real = await vi.importActual<typeof import("@/lib/ia/imagen")>("@/lib/ia/imagen");
  return { ...real, generarImagenDesdeFoto: ia.generar, descargarFotoBase: ia.descargar };
});
vi.mock("@/lib/cloudinary", () => ({
  CloudinaryNoConfiguradoError: class extends Error {},
  cloudinaryConfigurado: () => true,
  subirACloudinary: ia.subir,
  TRANSFORMACION_500: "c_pad,w_500,h_500,b_white,q_auto",
}));
vi.mock("@/lib/ml/cliente", async () => {
  const real = await vi.importActual<typeof import("@/lib/ml/cliente")>("@/lib/ml/cliente");
  return { ...real, diagnosticarImagenMl: ml.diagnostico };
});
vi.mock("@/lib/publicaciones/cola", () => ({
  crearTrabajoIA: cola.crearTrabajo,
  crearImagenesIA: cola.crearImagenes,
  leerImagenIA: cola.leerImagen,
  leerTrabajoIA: cola.leerTrabajo,
  actualizarPropuestaIA: cola.actualizar,
  tomarCupoImagen: cola.cupo,
  terminarImagenIA: cola.terminar,
}));

import { ajustarImagenAction, crearImagenAction, prepararImagenesAction } from "./actions";
import { cantidadDePortadas } from "@/lib/publicaciones/imagenesIA";

const FICHA = { nombre: { valor: "Termo 1 L", origen: "vendedor" }, incluye: { valor: ["Tapa"], origen: "foto" } };
const OPENAI = { id: "c", proveedor: "openai", baseUrl: null, modelo: "m", apiKey: LLAVE };

beforeEach(() => {
  estado.conPermiso = true;
  ia.conexion.mockReset().mockResolvedValue(OPENAI);
  ia.texto.mockReset().mockResolvedValue('{"titulo":"Así se usa","copy":["Abre","Sirve"],"composicion":"derecha"}');
  ia.generar.mockReset().mockResolvedValue({ buffer: Buffer.from("png"), tipo: "image/png" });
  ia.descargar.mockReset().mockResolvedValue({ buffer: Buffer.from("x"), tipo: "image/jpeg" });
  ia.subir.mockReset().mockResolvedValue({ url: "https://res.cloudinary.com/zx/ia.png" });
  ml.diagnostico.mockReset().mockResolvedValue({ status: 429, data: null });
  cola.crearTrabajo.mockReset().mockResolvedValue("trabajo-1");
  cola.crearImagenes.mockReset().mockImplementation(async (_e: string, _t: string, imgs: unknown[]) => imgs.map((_, i) => `img-${i}`));
  cola.leerImagen.mockReset().mockResolvedValue({ id: IMG, trabajoId: "trabajo-1", tipo: "portada", orden: 0, cuentaMlId: C1, estado: "propuesta", url: null, propuesta: { cuentaMlId: C1, indice: 1, cantidad: 1, asignacion: { composicion: 0, escena: 0 } } });
  cola.leerTrabajo.mockReset().mockResolvedValue({ id: "trabajo-1", siteId: "MCO", estilo: "zilonix_portadas", ficha: FICHA, cuentaMlId: C1 });
  cola.actualizar.mockReset();
  cola.cupo.mockReset().mockResolvedValue("tomado");
  cola.terminar.mockReset();
});

describe("cantidadDePortadas", () => {
  it("de 1 hasta una por cuenta marcada (mínimo 2 con una sola cuenta)", () => {
    expect(cantidadDePortadas(undefined, 5)).toBe(1);
    expect(cantidadDePortadas(10, 10)).toBe(10);
    expect(cantidadDePortadas(10, 3)).toBe(3);
    expect(cantidadDePortadas(2, 1)).toBe(2);
    expect(cantidadDePortadas(0, 4)).toBe(1);
    expect(cantidadDePortadas(2.5, 4)).toBe(1);
    expect(cantidadDePortadas("7", 10)).toBe(1);
  });
});

describe("preparar propuestas", () => {
  it("portadas: 1 por defecto, o varias distintas si se piden; no van a ninguna cuenta y nada se genera", async () => {
    const una = await prepararImagenesAction({ estilo: "zilonix_portadas", cuentaMlIds: [C1, C2, C3], ficha: FICHA });
    if (!una.ok) throw new Error(una.aviso);
    expect(una.imagenes).toHaveLength(1);
    expect(una.imagenes[0].cuentaMlId).toBeNull();
    const dos = await prepararImagenesAction({ estilo: "zilonix_portadas", cuentaMlIds: [C1], ficha: FICHA, cantidadPortadas: 2 });
    if (!dos.ok) throw new Error(dos.aviso);
    expect(dos.imagenes.map((i) => i.nombre)).toEqual(["Portada 1", "Portada 2"]);
    const composiciones = dos.imagenes.map((i) => (i.propuesta as { asignacion: { composicion: number } }).asignacion.composicion);
    expect(new Set(composiciones).size).toBe(2);
    // Con una sola cuenta, nunca más de 2.
    const raro = await prepararImagenesAction({ estilo: "zilonix_portadas", cuentaMlIds: [C1], ficha: FICHA, cantidadPortadas: 50 });
    if (!raro.ok) throw new Error(raro.aviso);
    expect(raro.imagenes).toHaveLength(2);
    // Con 3 cuentas marcadas, hasta 3 portadas distintas (una por cuenta).
    const tres = await prepararImagenesAction({ estilo: "zilonix_portadas", cuentaMlIds: [C1, C2, C3], ficha: FICHA, cantidadPortadas: 3 });
    if (!tres.ok) throw new Error(tres.aviso);
    expect(tres.imagenes.map((i) => i.nombre)).toEqual(["Portada 1", "Portada 2", "Portada 3"]);
    const pares = tres.imagenes.map((i) => JSON.stringify((i.propuesta as { asignacion: unknown }).asignacion));
    expect(new Set(pares).size).toBe(3);
    expect(ia.conexion).toHaveBeenCalledWith("empresa-1", "generacion_imagenes");
    expect(ia.generar).not.toHaveBeenCalled();
  });

  it("Claude conectado para imágenes: mensaje claro y ninguna llamada de imagen", async () => {
    ia.conexion.mockResolvedValue({ ...OPENAI, proveedor: "anthropic" });
    const r = await prepararImagenesAction({ estilo: "zilonix_portadas", cuentaMlIds: [C1], ficha: FICHA });
    expect(r).toMatchObject({ ok: false, conectarIA: true, aviso: expect.stringMatching(/Claude no genera imágenes/) });
    expect(ia.generar).not.toHaveBeenCalled();
  });

  it("sin ficha confirmada o sin permiso: no prepara", async () => {
    expect(await prepararImagenesAction({ estilo: "zilonix_portadas", cuentaMlIds: [C1], ficha: { nombre: { valor: "T", origen: "vendedor" }, alto: { valor: "9 cm", origen: "supuesto" } } })).toMatchObject({ ok: false });
    estado.conPermiso = false;
    expect(await prepararImagenesAction({ estilo: "zilonix_portadas", cuentaMlIds: [C1], ficha: FICHA })).toMatchObject({ ok: false, aviso: expect.stringMatching(/permiso/) });
  });

  it("contenido: opiniones reales sin opiniones se salta; con opiniones usa SOLO las del vendedor", async () => {
    const sin = await prepararImagenesAction({ estilo: "zilonix_contenido", cuentaMlIds: [C1], ficha: FICHA, tipos: ["modo_uso", "opiniones_reales"] });
    if (!sin.ok) throw new Error(sin.aviso);
    expect(sin.imagenes.map((i) => i.tipo)).toEqual(["modo_uso"]);
    expect(sin.omitidas.join(" ")).toMatch(/Opiniones reales/);
    const con = await prepararImagenesAction({ estilo: "zilonix_contenido", cuentaMlIds: [C1], ficha: FICHA, tipos: ["opiniones_reales"], opiniones: "Llegó rápido\nMe curó todo" });
    if (!con.ok) throw new Error(con.aviso);
    expect((con.imagenes[0].propuesta as { copy: string[] }).copy).toEqual(["Llegó rápido"]);
  });
});

describe("crear imagen", () => {
  it("con cupo: genera, sube a 500 × 500 y pone la portada; el diagnóstico 429 no bloquea", async () => {
    const r = await crearImagenAction({ imagenId: IMG, fotos: ["https://res.cloudinary.com/x/a.jpg"], categoriaId: "MCO8830" });
    expect(r).toEqual({ ok: true, estado: "lista", url: "https://res.cloudinary.com/zx/ia.png", validada: false, avisos: ["No se pudo validar la imagen con Mercado Libre."] });
    expect(ia.subir.mock.calls[0][3]).toBe("zilonix-publicaciones-ia");
    expect(ia.subir.mock.calls[0][4]).toMatch(/w_500,h_500/);
    expect(ml.diagnostico.mock.calls[0][2]).toBe("thumbnail");
    expect(JSON.stringify(r)).not.toContain(LLAVE);
  });

  it("sin cupo (2 generando): queda en cola y no genera", async () => {
    cola.cupo.mockResolvedValue("en_cola");
    expect(await crearImagenAction({ imagenId: IMG, fotos: ["https://res.cloudinary.com/x/a.jpg"] })).toEqual({ ok: true, estado: "en_cola" });
    expect(ia.generar).not.toHaveBeenCalled();
  });

  it("copy editado con palabra prohibida: no crea; las infografías se diagnostican como «other»", async () => {
    cola.leerImagen.mockResolvedValue({ id: IMG, trabajoId: "trabajo-1", tipo: "beneficios", orden: 2, cuentaMlId: null, estado: "propuesta", url: null, propuesta: { titulo: "Beneficios", copy: ["Suave"] } });
    cola.leerTrabajo.mockResolvedValue({ id: "trabajo-1", siteId: "MCO", estilo: "zilonix_contenido", ficha: FICHA, cuentaMlId: C1 });
    expect(await crearImagenAction({ imagenId: IMG, propuesta: { titulo: "Beneficios", copy: ["Resultados garantizados"] }, fotos: ["https://res.cloudinary.com/x/a.jpg"] })).toMatchObject({ ok: false });
    expect(cola.cupo).not.toHaveBeenCalled();
    await crearImagenAction({ imagenId: IMG, fotos: ["https://res.cloudinary.com/x/a.jpg"], categoriaId: "MCO8830" });
    expect(ml.diagnostico.mock.calls[0][2]).toBe("other");
  });

  it("«Ajustar» «Opiniones reales» sin opiniones se rechaza (la IA nunca las escribe); con opiniones usa solo esas", async () => {
    cola.leerImagen.mockResolvedValue({ id: IMG, trabajoId: "trabajo-1", tipo: "opiniones_reales", orden: 8, cuentaMlId: null, estado: "propuesta", url: null, propuesta: { titulo: "Opiniones", copy: ["Llegó bien"] } });
    cola.leerTrabajo.mockResolvedValue({ id: "trabajo-1", siteId: "MCO", estilo: "zilonix_contenido", ficha: FICHA, cuentaMlId: C1 });
    expect(await ajustarImagenAction({ imagenId: IMG, ajuste: "más cortas" })).toMatchObject({ ok: false, aviso: expect.stringMatching(/opiniones reales/) });
    expect(ia.texto).not.toHaveBeenCalled();
    const r = await ajustarImagenAction({ imagenId: IMG, ajuste: "más cortas", opiniones: "Buena calidad" });
    expect(r.ok && (r.propuesta as { copy: string[] }).copy).toEqual(["Buena calidad"]);
  });

  it("«Ajustar» una portada cambia la composición sin generar imagen ni repetir la de otra cuenta", async () => {
    const r = await ajustarImagenAction({ imagenId: IMG, asignadas: { [C2]: { composicion: 1, escena: 0 } } });
    if (!r.ok) throw new Error(r.aviso);
    const nueva = (r.propuesta as { asignacion: { composicion: number } }).asignacion.composicion;
    expect([0, 1]).not.toContain(nueva);
    expect(ia.generar).not.toHaveBeenCalled();
  });
});
