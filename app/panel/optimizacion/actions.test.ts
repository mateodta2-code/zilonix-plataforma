import { beforeEach, describe, expect, it, vi } from "vitest";

// Optimización, Fase 1 — acciones. Sin base ni Mercado Libre: se simulan
// la sesión, el permiso, la cuenta, el token y las llamadas.

const estado = vi.hoisted(() => ({ conPermiso: true, cuentaExiste: true, permisosPedidos: [] as string[] }));
const ml = vi.hoisted(() => ({
  visitas: vi.fn(),
  calidad: vi.fn(),
  competencia: vi.fn(),
  actualizar: vi.fn(),
  itemEdicion: vi.fn(),
  automatizacion: vi.fn(),
  producto: vi.fn(),
  ofertas: vi.fn(),
  fichas: vi.fn(),
  descripcion: vi.fn(),
  reputacion: vi.fn(),
}));
const auditorias = vi.hoisted(() => [] as unknown[]);

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
      if (!estado.conPermiso) throw new SinPermisoError("sin permiso");
    },
  };
});
vi.mock("@/db/empresa-context", () => ({
  dbComoEmpresa: async (_empresaId: string, fn: (tx: unknown) => Promise<unknown>) =>
    fn({
      select: () => ({
        from: () => ({
          where: async () => (estado.cuentaExiste ? [{ id: CUENTA, nickname: "TIENDA", siteId: "MCO" }] : []),
        }),
      }),
    }),
}));
vi.mock("@/lib/auditoria", () => ({ registrarAuditoria: async (_tx: unknown, entrada: unknown) => auditorias.push(entrada) }));
vi.mock("@/lib/ml/cuentas", () => ({ obtenerAccessTokenVigente: async () => "token" }));
vi.mock("@/lib/ml/preguntas", () => ({ motivoCuentaSinRevisar: () => "Token vencido — hay que reconectar la cuenta." }));
vi.mock("@/lib/ml/cliente", async () => {
  const real = await vi.importActual<typeof import("@/lib/ml/cliente")>("@/lib/ml/cliente");
  return {
    ...real,
    visitasItemMl: ml.visitas,
    calidadItemMl: ml.calidad,
    competenciaItemMl: ml.competencia,
    actualizarItemMl: ml.actualizar,
    leerItemEdicionMl: ml.itemEdicion,
    tieneAutomatizacionPrecioMl: ml.automatizacion,
    productoCatalogoDeItemMl: ml.producto,
    ofertasProductoCompetenciaMl: ml.ofertas,
    fichasPublicacionesMl: ml.fichas,
    tieneDescripcionMl: ml.descripcion,
    reputacionVendedorMl: ml.reputacion,
  };
});

const CUENTA = "11111111-1111-1111-1111-111111111111";

import { cambiarEstadoPublicacionAction, competenciaPublicacionAction, editarFotosAction, editarPrecioAction, editarTituloAction, metricasPublicacionesAction } from "./actions";

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
  const item = { id: "MCO1", titulo: "Faja", precio: 100000, vendidas: 0, tieneVariantes: false, estado: "active", fotos: [{ id: "f1", url: "https://a" }, { id: "f2", url: "https://b" }] };

  beforeEach(() => {
    estado.conPermiso = true;
    estado.cuentaExiste = true;
    estado.permisosPedidos = [];
    ml.actualizar.mockReset().mockResolvedValue({ ok: true, status: 200, data: {}, textoCrudo: "" });
    ml.itemEdicion.mockReset().mockResolvedValue(item);
    ml.automatizacion.mockReset().mockResolvedValue(false);
    auditorias.length = 0;
    vi.spyOn(console, "warn").mockImplementation(() => {});
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
    await editarFotosAction({ cuentaMlId: CUENTA, itemId: "MCO1", orden: ["f2", "f1", "ajena"], nuevas: ["https://nueva.jpg", "http://insegura.jpg", "javascript:x"] });
    expect(ml.actualizar).toHaveBeenCalledWith("MCO1", "token", { pictures: [{ id: "f2" }, { id: "f1" }, { source: "https://nueva.jpg" }] });
    ml.actualizar.mockClear();
    expect((await editarFotosAction({ cuentaMlId: CUENTA, itemId: "MCO1", orden: [], nuevas: [] })).ok).toBe(false);
    expect(ml.actualizar).not.toHaveBeenCalled();
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
