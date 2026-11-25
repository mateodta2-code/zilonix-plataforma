import { beforeEach, describe, expect, it, vi } from "vitest";

// Optimización, Fase 1 — acciones. Sin base ni Mercado Libre: se simulan
// la sesión, el permiso, la cuenta, el token y las llamadas.

const estado = vi.hoisted(() => ({ conPermiso: true, cuentaExiste: true, permisosPedidos: [] as string[], denegados: [] as string[] }));
const ml = vi.hoisted(() => ({
  visitas: vi.fn(),
  calidad: vi.fn(),
  competencia: vi.fn(),
  actualizar: vi.fn(),
  familia: vi.fn(),
  itemEdicion: vi.fn(),
  automatizacion: vi.fn(),
  promocion: vi.fn(),
  producto: vi.fn(),
  ofertas: vi.fn(),
  fichas: vi.fn(),
  descripcion: vi.fn(),
  leerDescripcion: vi.fn(),
  atributos: vi.fn(),
  tendencias: vi.fn(),
  reputacion: vi.fn(),
}));
const auditorias = vi.hoisted(() => [] as unknown[]);
const ia = vi.hoisted(() => ({ conexion: vi.fn(), descargar: vi.fn(), generar: vi.fn(), subir: vi.fn(), texto: vi.fn(), cloudinary: { configurado: true } }));

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
    requierePermiso: async (_u: string, _e: string, modulo: string, accion: string) => {
      estado.permisosPedidos.push(`${modulo}.${accion}`);
      if (!estado.conPermiso || estado.denegados.includes(`${modulo}.${accion}`)) throw new SinPermisoError("sin permiso");
    },
  };
});
vi.mock("@/db/empresa-context", () => ({
  dbComoEmpresa: async (_empresaId: string, fn: (tx: unknown) => Promise<unknown>) =>
    fn({
      select: () => ({
        from: () => ({
          where: async () => (estado.cuentaExiste ? [{ id: CUENTA, nickname: "TIENDA", siteId: "MCO", cuentaIdExterna: "123456" }] : []),
        }),
      }),
    }),
}));
vi.mock("@/lib/auditoria", () => ({ registrarAuditoria: async (_tx: unknown, entrada: unknown) => auditorias.push(entrada) }));
vi.mock("@/lib/ml/cuentas", () => ({ obtenerAccessTokenVigente: async () => "token" }));
vi.mock("@/lib/ia/conexion", () => ({ obtenerConexionIAParaModulo: ia.conexion }));
vi.mock("@/lib/cloudinary", () => ({
  CloudinaryNoConfiguradoError: class extends Error {},
  cloudinaryConfigurado: () => ia.cloudinary.configurado,
  subirACloudinary: ia.subir,
}));
vi.mock("@/lib/ia/imagen", async () => {
  const real = await vi.importActual<typeof import("@/lib/ia/imagen")>("@/lib/ia/imagen");
  return { ...real, descargarFotoBase: ia.descargar, generarImagenDesdeFoto: ia.generar };
});
vi.mock("@/lib/ia/proveedores", async () => {
  const real = await vi.importActual<typeof import("@/lib/ia/proveedores")>("@/lib/ia/proveedores");
  return { ...real, llamarIA: ia.texto };
});
vi.mock("@/lib/ml/preguntas", () => ({ motivoCuentaSinRevisar: () => "Token vencido — hay que reconectar la cuenta." }));
const bitacora = vi.hoisted(() => ({ crearNota: vi.fn(), guardarRevision: vi.fn(), esDeLaPublicacion: vi.fn() }));
vi.mock("@/lib/optimizacion/bitacora", () => ({
  crearNotaBitacora: bitacora.crearNota,
  guardarRevisionCambio: bitacora.guardarRevision,
  cambioEsDeLaPublicacion: bitacora.esDeLaPublicacion,
}));
vi.mock("@/lib/ml/cliente", async () => {
  const real = await vi.importActual<typeof import("@/lib/ml/cliente")>("@/lib/ml/cliente");
  return {
    ...real,
    visitasItemMl: ml.visitas,
    calidadItemMl: ml.calidad,
    competenciaItemMl: ml.competencia,
    actualizarItemMl: ml.actualizar,
    actualizarNombreFamiliaMl: ml.familia,
    leerItemEdicionMl: ml.itemEdicion,
    tieneAutomatizacionPrecioMl: ml.automatizacion,
    promocionActivaMl: ml.promocion,
    productoCatalogoDeItemMl: ml.producto,
    ofertasProductoCompetenciaMl: ml.ofertas,
    fichasPublicacionesMl: ml.fichas,
    tieneDescripcionMl: ml.descripcion,
    leerDescripcionItemMl: ml.leerDescripcion,
    leerAtributosItemMl: ml.atributos,
    tendenciasPorNivelMl: ml.tendencias,
    reputacionVendedorMl: ml.reputacion,
  };
});

const CUENTA = "11111111-1111-1111-1111-111111111111";

import {
  cambiarEstadoPublicacionAction,
  competenciaPublicacionAction,
  diagnosticoPublicacionAction,
  editarFotosAction,
  editarPrecioAction,
  editarTituloAction,
  generarImagenIAAction,
  guardarNotaBitacoraAction,
  mejorarTituloIAAction,
  metricasPublicacionesAction,
  revisarCambioAction,
  proponerContenidoIAAction,
} from "./actions";
import { ErrorImagenIA } from "@/lib/ia/imagen";

describe("metricasPublicacionesAction (solo lectura)", () => {
  beforeEach(() => {
    estado.conPermiso = true;
    estado.cuentaExiste = true;
    estado.permisosPedidos = [];
    ml.visitas.mockReset().mockResolvedValue(40);
    ml.calidad.mockReset().mockResolvedValue({ puntaje: 78, nivel: "Profesional", pendientes: ["Agrega fotos"] });
    ml.competencia.mockReset().mockResolvedValue({ estado: "winning", precioParaGanar: 1000 });
  });

  it("pide consultar inventario y trae visitas, calidad y, solo en catálogo, competencia", async () => {
    const r = await metricasPublicacionesAction({
      cuentaMlId: CUENTA,
      items: [
        { id: "MCO1", catalogo: true },
        { id: "MCO2", catalogo: false },
      ],
    });
    expect(estado.permisosPedidos).toEqual(["inventario.consultar"]);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.metricas.MCO1.competencia?.estado).toBe("winning");
    expect(r.metricas.MCO2.competencia).toBeNull();
    expect(ml.competencia).toHaveBeenCalledTimes(1);
    expect(ml.competencia).toHaveBeenCalledWith("MCO1", "token", "MCO");
  });

  it("pide las visitas del período elegido; uno fuera de la lista cae a 7", async () => {
    await metricasPublicacionesAction({ cuentaMlId: CUENTA, items: [{ id: "MCO1", catalogo: false }], dias: 90 });
    expect(ml.visitas).toHaveBeenLastCalledWith("MCO1", "token", 90);
    await metricasPublicacionesAction({ cuentaMlId: CUENTA, items: [{ id: "MCO1", catalogo: false }], dias: 500 });
    expect(ml.visitas).toHaveBeenLastCalledWith("MCO1", "token", 7);
    await metricasPublicacionesAction({ cuentaMlId: CUENTA, items: [{ id: "MCO1", catalogo: false }] });
    expect(ml.visitas).toHaveBeenLastCalledWith("MCO1", "token", 7);
  });

  it("como máximo 10 publicaciones por pedido y descarta ids mal formados", async () => {
    const items = Array.from({ length: 15 }, (_, i) => ({ id: `MCO${i + 1}`, catalogo: false }));
    const r = await metricasPublicacionesAction({ cuentaMlId: CUENTA, items: [{ id: "x/../y", catalogo: false }, ...items] });
    expect(r.ok && Object.keys(r.metricas)).toHaveLength(10);
    expect(ml.visitas).not.toHaveBeenCalledWith("x/../y", expect.anything(), expect.anything());
  });

  it("una publicación que falla queda en null sin tumbar las demás", async () => {
    ml.visitas.mockImplementation(async (id: string) => {
      if (id === "MCO1") throw new Error("ML caído");
      return 5;
    });
    const r = await metricasPublicacionesAction({
      cuentaMlId: CUENTA,
      items: [
        { id: "MCO1", catalogo: false },
        { id: "MCO2", catalogo: false },
      ],
    });
    expect(r.ok && r.metricas.MCO1.visitas).toBeNull();
    expect(r.ok && r.metricas.MCO2.visitas).toBe(5);
  });

  it("sin permiso o con cuenta ajena no llama a Mercado Libre", async () => {
    estado.conPermiso = false;
    expect((await metricasPublicacionesAction({ cuentaMlId: CUENTA, items: [{ id: "MCO1", catalogo: true }] })).ok).toBe(false);
    estado.conPermiso = true;
    estado.cuentaExiste = false;
    expect((await metricasPublicacionesAction({ cuentaMlId: CUENTA, items: [{ id: "MCO1", catalogo: true }] })).ok).toBe(false);
    expect(ml.visitas).not.toHaveBeenCalled();
  });
});

describe("cambiarEstadoPublicacionAction (escribe en Mercado Libre)", () => {
  beforeEach(() => {
    estado.conPermiso = true;
    estado.cuentaExiste = true;
    estado.permisosPedidos = [];
    ml.actualizar.mockReset();
    auditorias.length = 0;
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  it("pausa con inventario.modificar y deja auditoría", async () => {
    ml.actualizar.mockResolvedValue({ ok: true, status: 200, data: { status: "paused" }, textoCrudo: "" });
    const r = await cambiarEstadoPublicacionAction({ cuentaMlId: CUENTA, itemId: "MCO1", activar: false });
    expect(estado.permisosPedidos).toEqual(["inventario.modificar"]);
    expect(ml.actualizar).toHaveBeenCalledWith("MCO1", "token", { status: "paused" });
    expect(r).toEqual({ ok: true, aviso: "Publicación pausada.", estado: "paused" });
    expect(auditorias).toHaveLength(1);
  });

  it("sin permiso de modificar no toca Mercado Libre", async () => {
    estado.conPermiso = false;
    const r = await cambiarEstadoPublicacionAction({ cuentaMlId: CUENTA, itemId: "MCO1", activar: true });
    expect(r.ok).toBe(false);
    expect(ml.actualizar).not.toHaveBeenCalled();
  });

  it("publicación en revisión: aviso claro; otro rechazo: sin el error crudo", async () => {
    ml.actualizar.mockResolvedValue({ ok: false, status: 400, data: null, textoCrudo: '{"cause":[{"code":"item.status.not_modifiable"}]}' });
    expect((await cambiarEstadoPublicacionAction({ cuentaMlId: CUENTA, itemId: "MCO1", activar: true })).aviso).toContain("revisando");
    ml.actualizar.mockResolvedValue({ ok: false, status: 400, data: null, textoCrudo: '{"message":"detalle interno de ML"}' });
    const r = await cambiarEstadoPublicacionAction({ cuentaMlId: CUENTA, itemId: "MCO1", activar: true });
    expect(r.ok).toBe(false);
    expect(r.aviso).not.toContain("detalle interno");
    expect(auditorias).toHaveLength(0);
  });

  it("rechaza un itemId mal formado", async () => {
    const r = await cambiarEstadoPublicacionAction({ cuentaMlId: CUENTA, itemId: "../users/1", activar: true });
    expect(r.ok).toBe(false);
    expect(ml.actualizar).not.toHaveBeenCalled();
  });
});

describe("Fase 3: editar precio, título y fotos", () => {
  const item = { id: "MCO1", titulo: "Faja", precio: 100000, vendidas: 0, tieneVariantes: false, estado: "active", userProduct: false, familyId: null, fotos: [{ id: "f1", url: "https://a" }, { id: "f2", url: "https://b" }] };

  beforeEach(() => {
    estado.conPermiso = true;
    estado.cuentaExiste = true;
    estado.permisosPedidos = [];
    ml.actualizar.mockReset().mockResolvedValue({ ok: true, status: 200, data: {}, textoCrudo: "" });
    ml.familia.mockReset().mockResolvedValue({ ok: true, status: 200, data: {}, textoCrudo: "" });
    ml.itemEdicion.mockReset().mockResolvedValue(item);
    ml.automatizacion.mockReset().mockResolvedValue(false);
    ml.promocion.mockReset().mockResolvedValue(null);
    auditorias.length = 0;
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  it("precio con promoción activa: guarda el normal y avisa qué precio ve el comprador", async () => {
    ml.promocion.mockResolvedValue({ precio: 79900, precioRegular: 119900, hasta: "2026-11-30T05:00:00.000Z" });
    const r = await editarPrecioAction({ cuentaMlId: CUENTA, itemId: "MCO1", precio: "129000" });
    expect(ml.actualizar).toHaveBeenCalledWith("MCO1", "token", { price: 129000 });
    expect(r.ok).toBe(true);
    expect(r.aviso).toContain("promoción activa");
    expect(r.aviso).toContain("79.900");
  });

  it("título de una publicación «User Products»: cambia el nombre de la familia, nunca PUT /items", async () => {
    ml.itemEdicion.mockResolvedValue({ ...item, userProduct: true, familyId: "6267009945680719" });
    const r = await editarTituloAction({ cuentaMlId: CUENTA, itemId: "MCO1", titulo: "Compresa de hielo para rodilla" });
    expect(r.ok).toBe(true);
    expect(ml.familia).toHaveBeenCalledWith("6267009945680719", "token", "Compresa de hielo para rodilla");
    expect(ml.actualizar).not.toHaveBeenCalled();
    expect(r.aviso).toContain("todas las publicaciones de este producto");
    expect(auditorias[0]).toMatchObject({ accion: "cambiar_titulo_publicacion", valorNuevo: "Compresa de hielo para rodilla" });
  });

  it("«User Products» sin family_id: no escribe y lo explica", async () => {
    ml.itemEdicion.mockResolvedValue({ ...item, userProduct: true, familyId: null });
    const r = await editarTituloAction({ cuentaMlId: CUENTA, itemId: "MCO1", titulo: "Compresa" });
    expect(r.ok).toBe(false);
    expect(ml.familia).not.toHaveBeenCalled();
    expect(ml.actualizar).not.toHaveBeenCalled();
  });

  it("precio: lee el texto según el sitio, pide modificar y audita antes/después", async () => {
    const r = await editarPrecioAction({ cuentaMlId: CUENTA, itemId: "MCO1", precio: "95.000" });
    expect(r.ok).toBe(true);
    expect(estado.permisosPedidos).toEqual(["inventario.modificar"]);
    expect(ml.actualizar).toHaveBeenCalledWith("MCO1", "token", { price: 95000 });
    expect(auditorias[0]).toMatchObject({ accion: "cambiar_precio_publicacion", valorAnterior: "100000", valorNuevo: "95000.00" });
  });

  it("precio: no escribe con variantes, con automatización de ML o con un precio inválido", async () => {
    ml.itemEdicion.mockResolvedValue({ ...item, tieneVariantes: true });
    expect((await editarPrecioAction({ cuentaMlId: CUENTA, itemId: "MCO1", precio: "95000" })).aviso).toContain("variantes");
    ml.itemEdicion.mockResolvedValue(item);
    ml.automatizacion.mockResolvedValue(true);
    expect((await editarPrecioAction({ cuentaMlId: CUENTA, itemId: "MCO1", precio: "95000" })).aviso).toContain("automatización");
    ml.automatizacion.mockResolvedValue(false);
    expect((await editarPrecioAction({ cuentaMlId: CUENTA, itemId: "MCO1", precio: "-1" })).ok).toBe(false);
    expect(ml.actualizar).not.toHaveBeenCalled();
  });

  it("título: solo sin ventas (lo vuelve a leer en ML), con espacios limpios", async () => {
    expect((await editarTituloAction({ cuentaMlId: CUENTA, itemId: "MCO1", titulo: "  Faja   reductora  " })).ok).toBe(true);
    expect(ml.actualizar).toHaveBeenCalledWith("MCO1", "token", { title: "Faja reductora" });
    ml.actualizar.mockClear();
    ml.itemEdicion.mockResolvedValue({ ...item, vendidas: 3 });
    expect((await editarTituloAction({ cuentaMlId: CUENTA, itemId: "MCO1", titulo: "Otro" })).aviso).toContain("sin ventas");
    expect(ml.actualizar).not.toHaveBeenCalled();
  });

  it("fotos: solo ids que ya tiene la publicación y enlaces https", async () => {
    await editarFotosAction({
      cuentaMlId: CUENTA,
      itemId: "MCO1",
      fotos: [{ url: "https://nueva.jpg" }, { id: "f2" }, { id: "ajena" }, { url: "http://insegura.jpg" }, { id: "f1" }, { url: "javascript:x" }, { id: "f2" }],
    });
    // La nueva puede quedar de portada; ids ajenos, http y repetidos se descartan.
    expect(ml.actualizar).toHaveBeenCalledWith("MCO1", "token", { pictures: [{ source: "https://nueva.jpg" }, { id: "f2" }, { id: "f1" }] });
    ml.actualizar.mockClear();
    expect((await editarFotosAction({ cuentaMlId: CUENTA, itemId: "MCO1", fotos: [] })).ok).toBe(false);
    expect(ml.actualizar).not.toHaveBeenCalled();
  });

  it("con «BODY_INVALID_FIELDS» muestra el detalle de ML (código, causas y campos) para soporte", async () => {
    ml.actualizar.mockResolvedValue({
      ok: false,
      status: 400,
      data: null,
      textoCrudo: JSON.stringify({ message: "BODY_INVALID_FIELDS", error: "body.invalid_fields", status: 400, cause: [{ code: "field.not_modifiable", message: "family_name is not modifiable", references: ["family_name"] }] }),
    });
    const r = await editarTituloAction({ cuentaMlId: CUENTA, itemId: "MCO1", titulo: "Faja reductora" });
    expect(r.ok).toBe(false);
    expect(r.aviso).toContain("detalle para soporte");
    expect(r.aviso).toContain("error: body.invalid_fields");
    expect(r.aviso).toContain("field.not_modifiable · family_name is not modifiable · campos: family_name");
  });

  it("si Mercado Libre rechaza, muestra su motivo y no audita; sin permiso no toca nada", async () => {
    ml.actualizar.mockResolvedValue({ ok: false, status: 400, data: null, textoCrudo: JSON.stringify({ message: "price is invalid" }) });
    expect((await editarPrecioAction({ cuentaMlId: CUENTA, itemId: "MCO1", precio: "95000" })).aviso).toBe("Mercado Libre no aceptó el cambio: price is invalid");
    expect(auditorias).toHaveLength(0);
    estado.conPermiso = false;
    ml.actualizar.mockClear();
    expect((await editarTituloAction({ cuentaMlId: CUENTA, itemId: "MCO1", titulo: "X" })).ok).toBe(false);
    expect(ml.actualizar).not.toHaveBeenCalled();
  });
});

describe("Fase 4: competencia del mismo producto", () => {
  beforeEach(() => {
    estado.conPermiso = true;
    estado.cuentaExiste = true;
    estado.permisosPedidos = [];
    ml.producto.mockReset().mockResolvedValue("MCO999");
    ml.ofertas.mockReset().mockResolvedValue([
      { itemId: "MCO1", vendedorId: "1", precio: 110000, precioOriginal: null, tipoPublicacion: "gold_pro", envioGratis: true, full: false },
      { itemId: "MCO2", vendedorId: "2", precio: 100000, precioOriginal: null, tipoPublicacion: "gold_pro", envioGratis: true, full: true },
    ]);
    ml.fichas.mockReset().mockResolvedValue(new Map([["MCO2", { titulo: "Otra", foto: null, fotos: 9, video: true }]]));
    ml.descripcion.mockReset().mockResolvedValue(true);
    ml.reputacion.mockReset().mockResolvedValue({ nivel: "5_green", lider: "gold" });
  });

  it("compara contra los otros vendedores (solo lectura, consultar)", async () => {
    const r = await competenciaPublicacionAction({ cuentaMlId: CUENTA, itemId: "MCO1" });
    expect(estado.permisosPedidos).toEqual(["inventario.consultar"]);
    expect(r.ok && r.catalogo).toBe(true);
    if (!r.ok || !r.catalogo) return;
    expect(r.propia).toMatchObject({ itemId: "MCO1", propia: true, precio: 110000 });
    expect(r.competidores.map((c) => c.itemId)).toEqual(["MCO2"]);
    expect(r.competidores[0]).toMatchObject({ titulo: "Otra", fotos: 9, reputacion: { nivel: "5_green", lider: "gold" } });
    expect(r.total).toBe(1);
    expect(r.alertas).toContain("Tu precio está 10 % arriba del más barato.");
    expect(r.alertas).toContain("Te falta Full (1 de 1 lo tienen).");
    expect(ml.actualizar).not.toHaveBeenCalled();
  });

  it("fuera del catálogo avisa que necesita la extensión", async () => {
    ml.producto.mockResolvedValue(null);
    expect(await competenciaPublicacionAction({ cuentaMlId: CUENTA, itemId: "MCO1" })).toEqual({ ok: true, catalogo: false });
    expect(ml.ofertas).not.toHaveBeenCalled();
  });
});

describe("crear imagen con IA (no toca Mercado Libre)", () => {
  const ENTRADA = { cuentaMlId: CUENTA, itemId: "MCO1", fotoUrl: "https://http2.mlstatic.com/a.jpg", tipo: "portada", indicaciones: "mango naranja" };

  beforeEach(() => {
    estado.conPermiso = true;
    estado.cuentaExiste = true;
    estado.permisosPedidos = [];
    ia.cloudinary.configurado = true;
    ml.itemEdicion.mockReset().mockResolvedValue({ id: "MCO1", titulo: "Tijera", precio: 1, vendidas: 0, tieneVariantes: false, fotos: [] });
    ml.actualizar.mockReset();
    ia.conexion.mockReset().mockResolvedValue({ id: "c", proveedor: "openai", baseUrl: null, modelo: "x", actualizadoTs: new Date(), apiKey: "k" });
    ia.descargar.mockReset().mockResolvedValue({ buffer: Buffer.from("x"), tipo: "image/jpeg" });
    ia.generar.mockReset().mockResolvedValue({ buffer: Buffer.from("y"), tipo: "image/png" });
    ia.subir.mockReset().mockResolvedValue({ url: "https://res.cloudinary.com/zx/ia.png" });
  });

  it("pide modificar inventario, genera desde la foto base y la sube a Cloudinary; nunca escribe en ML", async () => {
    const r = await generarImagenIAAction(ENTRADA);
    expect(r).toEqual({ ok: true, url: "https://res.cloudinary.com/zx/ia.png", aviso: expect.any(String) });
    expect(estado.permisosPedidos).toEqual(["inventario.modificar"]);
    expect(ia.descargar).toHaveBeenCalledWith("https://http2.mlstatic.com/a.jpg");
    const prompt = ia.generar.mock.calls[0][2] as string;
    expect(prompt).toMatch(/blanco puro/);
    expect(prompt).toContain("Tijera");
    expect(prompt).toContain("mango naranja");
    expect(ia.subir).toHaveBeenCalledWith(Buffer.from("y"), "ia-portada-1-MCO1", "image/png", "zilonix-optimizacion-ia");
    expect(ml.actualizar).not.toHaveBeenCalled();
  });

  it("manda hasta 2 fotos más de referencia; una que no baja no frena la imagen", async () => {
    ia.descargar.mockImplementation(async (url: string) => {
      if (url.endsWith("c.jpg")) throw new ErrorImagenIA("no baja");
      return { buffer: Buffer.from(url), tipo: "image/jpeg" };
    });
    const r = await generarImagenIAAction({
      ...ENTRADA,
      referencias: ["https://http2.mlstatic.com/a.jpg", "https://http2.mlstatic.com/b.jpg", "https://http2.mlstatic.com/c.jpg", "https://http2.mlstatic.com/d.jpg"],
      variante: 4,
    });
    expect(r.ok).toBe(true);
    // la base no se repite; solo 2 extra (b, c) y c falló
    expect(ia.descargar.mock.calls.map((c) => c[0])).toEqual(["https://http2.mlstatic.com/a.jpg", "https://http2.mlstatic.com/b.jpg", "https://http2.mlstatic.com/c.jpg"]);
    expect((ia.generar.mock.calls[0][1] as unknown[]).length).toBe(2);
    expect(ia.subir.mock.calls[0][1]).toBe("ia-portada-5-MCO1");
  });

  it("sin permiso, sin IA conectada o sin Cloudinary: avisa y no llama a la IA", async () => {
    estado.conPermiso = false;
    expect((await generarImagenIAAction(ENTRADA)).ok).toBe(false);
    estado.conPermiso = true;
    ia.conexion.mockResolvedValue(null);
    expect((await generarImagenIAAction(ENTRADA)).aviso).toMatch(/Conectar IA/);
    ia.cloudinary.configurado = false;
    expect((await generarImagenIAAction(ENTRADA)).aviso).toMatch(/Cloudinary/);
    expect(ia.generar).not.toHaveBeenCalled();
  });

  it("un error de la IA llega con su texto; uno inesperado, genérico", async () => {
    ia.generar.mockRejectedValueOnce(new ErrorImagenIA("OpenAI rechazó la clave de IA de la empresa (revisa Administración → Conectar IA)."));
    expect((await generarImagenIAAction(ENTRADA)).aviso).toMatch(/rechazó la clave/);
    ia.generar.mockRejectedValueOnce(new Error("detalle interno con datos"));
    expect((await generarImagenIAAction(ENTRADA)).aviso).toBe("No se pudo crear la imagen. Intenta de nuevo.");
  });
});

describe("imágenes informativas: proponer, aprobar y crear", () => {
  const CONTENIDO = { tipo: "modo_uso", titulo: "Así se usa", bullets: ["Abre la tapa", "Aplica una capa", "Deja secar"], composicion: "derecha" };
  const BASE = { cuentaMlId: CUENTA, itemId: "MCO1", fotoUrl: "https://http2.mlstatic.com/a.jpg", tipo: "informativa" };

  beforeEach(() => {
    estado.conPermiso = true;
    estado.cuentaExiste = true;
    estado.permisosPedidos = [];
    ia.cloudinary.configurado = true;
    ml.itemEdicion.mockReset().mockResolvedValue({ id: "MCO1", titulo: "Crema 50 g", precio: 1, vendidas: 0, tieneVariantes: false, fotos: [] });
    ml.leerDescripcion.mockReset().mockResolvedValue("Crema para uso diario");
    ml.actualizar.mockReset();
    ia.conexion.mockReset().mockResolvedValue({ id: "c", proveedor: "openai", baseUrl: null, modelo: "x", actualizadoTs: new Date(), apiKey: "k" });
    ia.texto.mockReset().mockResolvedValue('{"titulo":"Así se usa","bullets":["Abre","Aplica","Alivio al instante"],"composicion":"centro"}');
    ia.descargar.mockReset().mockResolvedValue({ buffer: Buffer.from("x"), tipo: "image/jpeg" });
    ia.generar.mockReset().mockResolvedValue({ buffer: Buffer.from("y"), tipo: "image/png" });
    ia.subir.mockReset().mockResolvedValue({ url: "https://res.cloudinary.com/zx/info.png" });
  });

  it("proponer usa la ficha, el título y la descripción; avisa las palabras prohibidas; no crea imagen", async () => {
    const r = await proponerContenidoIAAction({ cuentaMlId: CUENTA, itemId: "MCO1", tipoContenido: "modo_uso", ficha: "Aplicar dos veces al día" });
    expect(r).toEqual({ ok: true, contenido: { tipo: "modo_uso", titulo: "Así se usa", bullets: ["Abre", "Aplica", "Alivio al instante"], composicion: "centro" }, prohibidas: ["alivio / alivia"] });
    const pedido = ia.texto.mock.calls[0][1] as string;
    expect(pedido).toContain("Aplicar dos veces al día");
    expect(pedido).toContain("Crema 50 g");
    expect(pedido).toContain("Crema para uso diario");
    expect(estado.permisosPedidos).toEqual(["inventario.modificar"]);
    expect(ia.generar).not.toHaveBeenCalled();
    expect(ml.actualizar).not.toHaveBeenCalled();
  });

  it("las opiniones nunca las propone la IA", async () => {
    const r = await proponerContenidoIAAction({ cuentaMlId: CUENTA, itemId: "MCO1", tipoContenido: "opiniones" });
    expect(r.ok).toBe(false);
    expect(ia.texto).not.toHaveBeenCalled();
  });

  it("crear exige el contenido aprobado y lo vuelve a revisar en el servidor", async () => {
    expect((await generarImagenIAAction(BASE)).aviso).toMatch(/apruébalo/);
    expect((await generarImagenIAAction({ ...BASE, contenido: { ...CONTENIDO, bullets: ["Abre", "Cura todo"] } })).aviso).toMatch(/cura/);
    expect(ia.generar).not.toHaveBeenCalled();

    const r = await generarImagenIAAction({ ...BASE, contenido: CONTENIDO });
    expect(r.ok).toBe(true);
    const prompt = ia.generar.mock.calls[0][2] as string;
    expect(prompt).toContain('"Así se usa"');
    expect(prompt).toContain("producto a la derecha");
    expect(prompt).toContain("Crema 50 g");
    expect(ia.subir.mock.calls[0][1]).toBe("ia-modo_uso-MCO1");
    expect(ml.actualizar).not.toHaveBeenCalled();
  });
});

describe("bitácora: notas a mano y revisión", () => {
  const REF = "auditoria:11111111-2222-3333-4444-555555555555";
  beforeEach(() => {
    estado.conPermiso = true;
    estado.cuentaExiste = true;
    estado.permisosPedidos = [];
    ml.itemEdicion.mockReset().mockResolvedValue({ id: "MCO1342632705", titulo: "Tijera", precio: 1, vendidas: 0, tieneVariantes: false, sellerId: "123456", fotos: [] });
    bitacora.crearNota.mockReset().mockResolvedValue("nota-1");
    bitacora.guardarRevision.mockReset().mockResolvedValue(undefined);
    bitacora.esDeLaPublicacion.mockReset().mockResolvedValue(true);
  });

  it("nota: pide modificar, valida texto y fecha, y guarda con la publicación confirmada por Mercado Libre", async () => {
    expect(await guardarNotaBitacoraAction({ cuentaMlId: CUENTA, itemId: "MCO1342632705", fecha: "2026-11-10", texto: "   " })).toMatchObject({ ok: false });
    expect(await guardarNotaBitacoraAction({ cuentaMlId: CUENTA, itemId: "MCO1342632705", fecha: "2099-01-01", texto: "Subí la campaña" })).toMatchObject({ ok: false, aviso: expect.stringMatching(/fecha/) });
    expect(bitacora.crearNota).not.toHaveBeenCalled();
    const hoy = new Date().toISOString().slice(0, 10);
    const ayer = new Date(Date.now() - 2 * 86_400_000).toISOString().slice(0, 10);
    const r = await guardarNotaBitacoraAction({ cuentaMlId: CUENTA, itemId: "MCO1342632705", fecha: ayer <= hoy ? ayer : hoy, texto: " Subí la  campaña " });
    expect(r.ok).toBe(true);
    expect(bitacora.crearNota.mock.calls[0][1]).toMatchObject({ itemId: "MCO1342632705", texto: "Subí la campaña", cuentaMlId: CUENTA });
    expect(estado.permisosPedidos).toContain("inventario.modificar");
  });

  it("nota: rechaza una publicación de otra cuenta (seller_id distinto)", async () => {
    ml.itemEdicion.mockResolvedValue({ id: "MCO1342632705", titulo: "Tijera", precio: 1, vendidas: 0, tieneVariantes: false, sellerId: "999", fotos: [] });
    const hoy = new Date().toISOString().slice(0, 10);
    expect(await guardarNotaBitacoraAction({ cuentaMlId: CUENTA, itemId: "MCO1342632705", fecha: hoy, texto: "Subí la campaña" })).toMatchObject({ ok: false, aviso: expect.stringMatching(/no es de esta cuenta/) });
    expect(bitacora.crearNota).not.toHaveBeenCalled();
  });

  it("revisar: solo resultados válidos y solo cambios de esa publicación", async () => {
    expect(await revisarCambioAction({ cuentaMlId: CUENTA, itemId: "MCO1342632705", ref: REF, resultado: "genial" })).toMatchObject({ ok: false });
    bitacora.esDeLaPublicacion.mockResolvedValue(false);
    expect(await revisarCambioAction({ cuentaMlId: CUENTA, itemId: "MCO1342632705", ref: REF, resultado: "sirvio" })).toMatchObject({ ok: false, aviso: expect.stringMatching(/No se encontró/) });
    expect(bitacora.guardarRevision).not.toHaveBeenCalled();
    bitacora.esDeLaPublicacion.mockResolvedValue(true);
    expect(await revisarCambioAction({ cuentaMlId: CUENTA, itemId: "MCO1342632705", ref: REF, resultado: "no_sirvio", comentario: " bajaron las visitas " })).toEqual({ ok: true, aviso: "Revisión guardada." });
    expect(bitacora.guardarRevision.mock.calls[0][1]).toMatchObject({ ref: REF, resultado: "no_sirvio", comentario: "bajaron las visitas" });
  });

  it("revisar: solo comentario (sin resultado) se guarda y avisa que sigue sin revisar; vacío no", async () => {
    expect(await revisarCambioAction({ cuentaMlId: CUENTA, itemId: "MCO1342632705", ref: REF, resultado: "", comentario: "   " })).toMatchObject({ ok: false, aviso: expect.stringMatching(/resultado o escribe un comentario/) });
    expect(bitacora.guardarRevision).not.toHaveBeenCalled();
    const r = await revisarCambioAction({ cuentaMlId: CUENTA, itemId: "MCO1342632705", ref: REF, resultado: "", comentario: " bajé el precio por la competencia " });
    expect(r).toMatchObject({ ok: true, aviso: expect.stringMatching(/Elige un resultado/) });
    expect(bitacora.guardarRevision.mock.calls[0][1]).toMatchObject({ ref: REF, resultado: null, comentario: "bajé el precio por la competencia" });
  });

  it("sin permiso de modificar: no anota ni revisa", async () => {
    estado.conPermiso = false;
    expect((await revisarCambioAction({ cuentaMlId: CUENTA, itemId: "MCO1342632705", ref: REF, resultado: "sirvio" })).ok).toBe(false);
    expect((await guardarNotaBitacoraAction({ cuentaMlId: CUENTA, itemId: "MCO1342632705", fecha: "2026-11-10", texto: "x" })).ok).toBe(false);
    expect(bitacora.guardarRevision).not.toHaveBeenCalled();
    expect(bitacora.crearNota).not.toHaveBeenCalled();
  });
});

describe("diagnóstico de solo lectura (solo administradores)", () => {
  const ITEM = "MCO4656053860";
  const respuestas = new Map<string, { ok: boolean; status: number; data?: unknown }>();
  const llamadas: { url: string; metodo: string; auth: string }[] = [];

  beforeEach(() => {
    estado.conPermiso = true;
    estado.cuentaExiste = true;
    estado.permisosPedidos = [];
    estado.denegados = [];
    llamadas.length = 0;
    respuestas.clear();
    respuestas.set(`/items/${ITEM}`, {
      ok: true,
      status: 200,
      data: { id: ITEM, title: "Faja reductora negra", family_name: "Faja reductora", user_product_id: "MCOU123456", family_id: 987, price: 50000, seller_id: 123456, variations: [] },
    });
    respuestas.set(`/items/${ITEM}/prices`, { ok: true, status: 200, data: { prices: [{ type: "standard", amount: 50000 }] } });
    respuestas.set("/user-products/MCOU123456", { ok: true, status: 200, data: { id: "MCOU123456", family_id: 987, name: "Faja reductora negra", user_id: 123456 } });
    respuestas.set("/users/123456/items/search", { ok: true, status: 200, data: { results: [ITEM, "MCO999"] } });
    respuestas.set("/items", {
      ok: true,
      status: 200,
      data: [
        { code: 200, body: { id: ITEM, status: "active", listing_type_id: "gold_pro", sold_quantity: 0 } },
        { code: 200, body: { id: "MCO999", status: "active", listing_type_id: "gold_special", sold_quantity: 7 } },
      ],
    });
    ml.automatizacion.mockReset().mockResolvedValue(false);
    vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
      const ruta = new URL(url).pathname;
      const auth = new Headers(init?.headers).get("Authorization") ?? "";
      llamadas.push({ url, metodo: init?.method ?? "GET", auth });
      const r = respuestas.get(ruta) ?? { ok: false, status: 404 };
      return new Response(JSON.stringify(r.data ?? {}), { status: r.status, headers: { "content-type": "application/json" } });
    });
  });

  it("sin permiso de administrador no consulta Mercado Libre", async () => {
    estado.denegados = ["configuracion.autorizar"];
    const r = await diagnosticoPublicacionAction({ cuentaMlId: CUENTA, itemId: ITEM });
    expect(r).toEqual({ ok: false, aviso: "El diagnóstico es solo para administradores de la empresa." });
    expect(estado.permisosPedidos).toContain("configuracion.autorizar");
    expect(llamadas).toHaveLength(0);
  });

  it("solo hace GET y no muestra el token ni ids de la cuenta", async () => {
    const r = await diagnosticoPublicacionAction({ cuentaMlId: CUENTA, itemId: ITEM });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(llamadas.length).toBeGreaterThan(0);
    expect(llamadas.every((l) => l.metodo === "GET")).toBe(true);
    const texto = r.lineas.join("\n");
    expect(texto).toContain('user_product_id: "MCOU123456"');
    expect(texto).toContain("family_id: 987");
    expect(texto).toContain('family_name: "Faja reductora"');
    expect(texto).toContain("el título empieza con family_name: sí");
    expect(texto).toContain("automatización de precios activa: no");
    expect(texto).toContain("publicaciones del mismo producto: 2 (ventas en total: 7)");
    expect(texto).toContain('"MCO999" · estado "active" · tipo "gold_special" · ventas 7');
    expect(texto).not.toContain("/users/");
    expect(texto).not.toContain("token");
    expect(texto).not.toContain("seller_id");
    expect(texto).not.toContain("user_id");
    expect(texto).not.toContain("123456,");
  });

  it("rechaza un id de publicación inválido sin llamar a Mercado Libre", async () => {
    const r = await diagnosticoPublicacionAction({ cuentaMlId: CUENTA, itemId: "../users/me" });
    expect(r.ok).toBe(false);
    expect(llamadas).toHaveLength(0);
  });
});

describe("mejorarTituloIAAction (solo lectura en Mercado Libre)", () => {
  const ENTRADA = { cuentaMlId: CUENTA, itemId: "MCO1" };
  const RESPUESTA = '{"titulos":["Termo acero azul 1 L","Termo azul de acero","Termo de acero inoxidable"],"catalogo":"Termo de acero azul de 1 L para bebidas"}';

  function prepararCaso(vendidas: number) {
    estado.conPermiso = true;
    estado.cuentaExiste = true;
    estado.permisosPedidos = [];
    ml.itemEdicion.mockReset().mockResolvedValue({ id: "MCO1", titulo: "Termo acero azul 1 L", precio: 1, vendidas, tieneVariantes: false, userProduct: false, familyId: null, fotos: [] });
    ml.atributos.mockReset().mockResolvedValue({ categoriaId: "MCO1234", atributos: [{ id: "COLOR", nombre: "Color", valor: "Azul" }] });
    ml.tendencias.mockReset().mockResolvedValue({ ruta: ["Hogar", "Termos"], niveles: [{ nivel: "alta", palabras: ["termo acero"] }] });
    ml.leerDescripcion.mockReset().mockResolvedValue("Termo para bebidas calientes");
    ml.actualizar.mockReset();
    ml.familia.mockReset();
    ia.conexion.mockReset().mockResolvedValue({ id: "c", proveedor: "openai", baseUrl: null, modelo: "x", actualizadoTs: new Date(), apiKey: "k" });
    ia.texto.mockReset().mockResolvedValue(RESPUESTA);
  }

  it("sin IA conectada: el mismo aviso que Publicar, con enlace a Conectar IA", async () => {
    prepararCaso(0);
    ia.conexion.mockResolvedValue(null);
    const r = await mejorarTituloIAAction(ENTRADA);
    expect(r).toMatchObject({ ok: false, conectarIA: true });
    expect(ia.texto).not.toHaveBeenCalled();
    expect(ia.conexion).toHaveBeenCalledWith("empresa-1", "optimizacion");
  });

  it("sin ventas: devuelve títulos, límites y puedeGuardar; no escribe nada", async () => {
    prepararCaso(0);
    const r = await mejorarTituloIAAction(ENTRADA);
    expect(r).toMatchObject({ ok: true, largoMaximo: 60, largoMaximoCatalogo: 120, puedeGuardar: true, vendidas: 0 });
    expect(r.ok && r.titulos).toHaveLength(3);
    expect(r.ok && r.catalogo).not.toBeNull();
    expect(estado.permisosPedidos).toEqual(["inventario.modificar"]);
    const pedido = ia.texto.mock.calls[0][1] as string;
    expect(pedido).toContain("Termo acero azul 1 L");
    expect(pedido).toContain("termo acero");
    expect(ml.actualizar).not.toHaveBeenCalled();
    expect(ml.familia).not.toHaveBeenCalled();
  });

  it("con ventas: puedeGuardar es false", async () => {
    prepararCaso(4);
    const r = await mejorarTituloIAAction(ENTRADA);
    expect(r).toMatchObject({ ok: true, puedeGuardar: false, vendidas: 4 });
    expect(ml.actualizar).not.toHaveBeenCalled();
  });

  it("si ML no devuelve atributos ni tendencias, igual propone con el título", async () => {
    prepararCaso(0);
    ml.atributos.mockRejectedValue(new Error("x"));
    ml.leerDescripcion.mockRejectedValue(new Error("x"));
    const r = await mejorarTituloIAAction(ENTRADA);
    expect(r.ok).toBe(true);
    expect(ml.tendencias).not.toHaveBeenCalled();
  });

  it("errores claros: ML no devuelve la publicación, IA sin títulos, IA falla", async () => {
    prepararCaso(0);
    ml.itemEdicion.mockResolvedValue(null);
    expect(await mejorarTituloIAAction(ENTRADA)).toMatchObject({ ok: false, aviso: expect.stringContaining("Mercado Libre no devolvió") });
    prepararCaso(0);
    ia.texto.mockResolvedValue("no es json");
    expect(await mejorarTituloIAAction(ENTRADA)).toMatchObject({ ok: false, aviso: expect.stringContaining("no devolvió títulos usables") });
    prepararCaso(0);
    ia.texto.mockRejectedValue(new Error("boom"));
    expect(await mejorarTituloIAAction(ENTRADA)).toMatchObject({ ok: false });
  });

  it("sin permiso de editar no hace nada", async () => {
    prepararCaso(0);
    estado.conPermiso = false;
    expect(await mejorarTituloIAAction(ENTRADA)).toMatchObject({ ok: false });
    expect(ia.texto).not.toHaveBeenCalled();
  });
});
