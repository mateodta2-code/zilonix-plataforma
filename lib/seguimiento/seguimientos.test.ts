import { randomUUID } from "crypto";
import { eq } from "drizzle-orm";
import { afterEach, describe, expect, it, vi } from "vitest";
import { dbComoEmpresa } from "@/db/empresa-context";
import { cuentasMl, empresas, seguimientoAlertas, seguimientoFotos, seguimientosMl, usuarios } from "@/db/schema";
import { cifrarToken } from "@/lib/cifrado";
import {
  agregarSeguimiento,
  buscarMedicionSiExiste,
  buscarSeguimientoActivoPorMlId,
  contarCompetidoresActivos,
  eliminarSeguimiento,
  LIMITE_PRODUCTOS_COMPETIDOR_POR_EMPRESA,
  LIMITE_TIENDAS_COMPETIDOR_POR_EMPRESA,
  LimiteCompetidoresError,
  LinkMlInvalidoError,
  listarAlertasDelDia,
  listarSeguimientosConFotosParaVentas,
  listarSeguimientosConUltimaFoto,
  marcarAlertaLeida,
  NOMBRE_PENDIENTE_PRIMERA_REVISION,
  obtenerDetalleSeguimiento,
  resolverNombre,
  SinCuentaMlParaSeguimientoError,
  verificarCupoCompetidor,
} from "./seguimientos";

async function crearEmpresaConUsuario() {
  const empresaId = randomUUID();
  await dbComoEmpresa(empresaId, (tx) => tx.insert(empresas).values({ id: empresaId, nombre: "Empresa de prueba", nit: `TEST-SEG-${empresaId.slice(0, 8)}` }));
  const [usuario] = await dbComoEmpresa(empresaId, (tx) => tx.insert(usuarios).values({ email: `prueba-seguimiento-${empresaId}@zilonix.test`, nombre: "Usuario de prueba" }).returning({ id: usuarios.id }));
  return { empresaId, usuarioId: usuario.id };
}

async function conectarCuentaMl(empresaId: string) {
  await dbComoEmpresa(empresaId, (tx) =>
    tx.insert(cuentasMl).values({
      empresaId,
      cuentaIdExterna: `${Date.now()}${Math.floor(Math.random() * 10_000)}`,
      nickname: "VENDEDOR_SEGUIMIENTO",
      accessTokenCifrado: cifrarToken("access-vigente"),
      refreshTokenCifrado: cifrarToken("refresh"),
      tokenExpiraTs: new Date(Date.now() + 3600_000),
    })
  );
}

function respuestaJson(data: unknown, status = 200) {
  return { ok: status >= 200 && status < 300, status, json: async () => data } as Response;
}

// Issue #251 — `tipo` opcional, default "producto" (para no tocar
// las pruebas viejas que ya llamaban esto sin ese argumento) — las
// pruebas nuevas del cupo separado 5+5 lo pasan explícito.
async function crearSeguimiento(empresaId: string, usuarioId: string, esCompetidor: boolean, tipo: "producto" | "tienda" = "producto") {
  await dbComoEmpresa(empresaId, (tx) =>
    tx.insert(seguimientosMl).values(
      tipo === "tienda"
        ? {
            empresaId,
            tipo: "tienda",
            recursoMl: "seller",
            mlIdExterno: String(Math.floor(Math.random() * 1_000_000_000)),
            nombre: "Tienda de prueba",
            linkOriginal: "https://listado.mercadolibre.com.co/_CustId_1",
            esCompetidor,
            creadoPor: usuarioId,
          }
        : {
            empresaId,
            tipo: "producto",
            recursoMl: "item",
            mlIdExterno: `MCO${randomUUID().replace(/-/g, "").slice(0, 10)}`,
            nombre: "Producto de prueba",
            linkOriginal: "https://articulo.mercadolibre.com.co/MCO-1",
            esCompetidor,
            creadoPor: usuarioId,
          }
    )
  );
}

// Issue #175 — "máximo 5 competidores por empresa, validado en el
// servidor". Contra Postgres real (no un mock): dbComoEmpresa exige
// una conexión real, igual que el resto de las pruebas de este repo.
describe("verificarCupoCompetidor / contarCompetidoresActivos (issue #175, dos pozos separados desde #251)", () => {
  it("cuenta solo los marcados como competidor del TIPO pedido, nunca los demás seguimientos ni el otro tipo", async () => {
    const { empresaId, usuarioId } = await crearEmpresaConUsuario();
    await crearSeguimiento(empresaId, usuarioId, true, "producto");
    await crearSeguimiento(empresaId, usuarioId, false, "producto");
    await crearSeguimiento(empresaId, usuarioId, true, "tienda");

    expect(await contarCompetidoresActivos(empresaId, "producto")).toBe(1);
    expect(await contarCompetidoresActivos(empresaId, "tienda")).toBe(1);
  });

  it(`deja agregar hasta ${LIMITE_PRODUCTOS_COMPETIDOR_POR_EMPRESA} productos, el sexto lanza LimiteCompetidoresError`, async () => {
    const { empresaId, usuarioId } = await crearEmpresaConUsuario();
    for (let i = 0; i < LIMITE_PRODUCTOS_COMPETIDOR_POR_EMPRESA; i++) {
      await expect(verificarCupoCompetidor(empresaId, "producto")).resolves.toBeUndefined();
      await crearSeguimiento(empresaId, usuarioId, true, "producto");
    }
    expect(await contarCompetidoresActivos(empresaId, "producto")).toBe(LIMITE_PRODUCTOS_COMPETIDOR_POR_EMPRESA);
    await expect(verificarCupoCompetidor(empresaId, "producto")).rejects.toThrow(LimiteCompetidoresError);
  });

  // Issue #251 — regresión directa: el pozo de tiendas lleno NO
  // bloquea el de productos, y viceversa. Antes de #251 había un solo
  // pozo combinado de 5 — esta prueba es la que hubiera fallado con
  // ese código viejo (5 tiendas ya hubieran dejado el pozo combinado
  // en el tope, bloqueando también el primer producto).
  it(`el pozo de tiendas lleno (${LIMITE_TIENDAS_COMPETIDOR_POR_EMPRESA}) no afecta el cupo de productos, y viceversa`, async () => {
    const { empresaId, usuarioId } = await crearEmpresaConUsuario();
    for (let i = 0; i < LIMITE_TIENDAS_COMPETIDOR_POR_EMPRESA; i++) await crearSeguimiento(empresaId, usuarioId, true, "tienda");
    await expect(verificarCupoCompetidor(empresaId, "tienda")).rejects.toThrow(LimiteCompetidoresError);

    // El pozo de PRODUCTOS sigue entero, en 0 — nunca se mezcla con el de tiendas.
    expect(await contarCompetidoresActivos(empresaId, "producto")).toBe(0);
    await expect(verificarCupoCompetidor(empresaId, "producto")).resolves.toBeUndefined();
  });

  it("quitar un competidor (eliminado_ts) libera cupo real, del mismo tipo", async () => {
    const { empresaId, usuarioId } = await crearEmpresaConUsuario();
    for (let i = 0; i < LIMITE_PRODUCTOS_COMPETIDOR_POR_EMPRESA; i++) await crearSeguimiento(empresaId, usuarioId, true, "producto");
    await expect(verificarCupoCompetidor(empresaId, "producto")).rejects.toThrow(LimiteCompetidoresError);

    const [unCompetidor] = await dbComoEmpresa(empresaId, (tx) => tx.select({ id: seguimientosMl.id }).from(seguimientosMl).limit(1));
    await dbComoEmpresa(empresaId, (tx) => tx.update(seguimientosMl).set({ eliminadoTs: new Date() }).where(eq(seguimientosMl.id, unCompetidor.id)));

    expect(await contarCompetidoresActivos(empresaId, "producto")).toBe(LIMITE_PRODUCTOS_COMPETIDOR_POR_EMPRESA - 1);
    await expect(verificarCupoCompetidor(empresaId, "producto")).resolves.toBeUndefined();
  });

  it("el límite es por empresa: otra empresa con el cupo lleno no afecta a esta", async () => {
    const otra = await crearEmpresaConUsuario();
    for (let i = 0; i < LIMITE_PRODUCTOS_COMPETIDOR_POR_EMPRESA; i++) await crearSeguimiento(otra.empresaId, otra.usuarioId, true, "producto");

    const { empresaId } = await crearEmpresaConUsuario();
    expect(await contarCompetidoresActivos(empresaId, "producto")).toBe(0);
    await expect(verificarCupoCompetidor(empresaId, "producto")).resolves.toBeUndefined();
  });
});

describe("agregarSeguimiento (issue #175)", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("sin ninguna cuenta ML conectada: SinCuentaMlParaSeguimientoError, nunca llega a tocar la tabla", async () => {
    const { empresaId, usuarioId } = await crearEmpresaConUsuario();
    await expect(agregarSeguimiento(empresaId, usuarioId, { tipo: "producto", link: "MCO111", esCompetidor: false })).rejects.toThrow(
      SinCuentaMlParaSeguimientoError
    );
  });

  it("link irreconocible: LinkMlInvalidoError, nunca pide el token ni toca Mercado Libre", async () => {
    const { empresaId, usuarioId } = await crearEmpresaConUsuario();
    await conectarCuentaMl(empresaId);
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    await expect(agregarSeguimiento(empresaId, usuarioId, { tipo: "producto", link: "esto no es nada", esCompetidor: false })).rejects.toThrow(
      LinkMlInvalidoError
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("producto por link de publicación: queda como recurso item, con el nombre real de Mercado Libre", async () => {
    const { empresaId, usuarioId } = await crearEmpresaConUsuario();
    await conectarCuentaMl(empresaId);
    vi.stubGlobal("fetch", vi.fn(async () => respuestaJson({ id: "MCO111", title: "Reloj digital", thumbnail: "foto.jpg", status: "active" })));

    const seguimiento = await agregarSeguimiento(empresaId, usuarioId, {
      tipo: "producto",
      link: "https://articulo.mercadolibre.com.co/MCO-111-reloj",
      esCompetidor: false,
    });

    expect(seguimiento.recursoMl).toBe("item");
    expect(seguimiento.mlIdExterno).toBe("MCO111");
    expect(seguimiento.nombre).toBe("Reloj digital");
  });

  // Issue #201 — bug real en staging: antes el fallback era el id tal
  // cual (ej. "123456789") y la tabla se llenaba de ids indistinguibles
  // entre sí. Ahora el fallback es un placeholder explícito, nunca el
  // id — lib/trabajos/revisionDiariaSeguimiento.ts reintenta resolverlo
  // en la próxima revisión diaria mientras siga pendiente.
  it("tienda por seller_id: si Mercado Libre no deja ver el nickname, usa el placeholder (nunca el id, nunca revienta)", async () => {
    const { empresaId, usuarioId } = await crearEmpresaConUsuario();
    await conectarCuentaMl(empresaId);
    vi.stubGlobal("fetch", vi.fn(async () => respuestaJson({}, 403)));

    const seguimiento = await agregarSeguimiento(empresaId, usuarioId, { tipo: "tienda", link: "123456789", esCompetidor: false });

    expect(seguimiento.recursoMl).toBe("seller");
    expect(seguimiento.mlIdExterno).toBe("123456789");
    expect(seguimiento.nombre).toBe(NOMBRE_PENDIENTE_PRIMERA_REVISION);
  });

  it("competidor que supera el cupo de 5: LimiteCompetidoresError, nunca inserta un sexto", async () => {
    const { empresaId, usuarioId } = await crearEmpresaConUsuario();
    await conectarCuentaMl(empresaId);
    vi.stubGlobal("fetch", vi.fn(async () => respuestaJson({ id: "X", title: "X", status: "active" })));
    for (let i = 0; i < LIMITE_PRODUCTOS_COMPETIDOR_POR_EMPRESA; i++) {
      await agregarSeguimiento(empresaId, usuarioId, { tipo: "producto", link: `MCO${i}`, esCompetidor: true });
    }
    await expect(agregarSeguimiento(empresaId, usuarioId, { tipo: "producto", link: "MCO999", esCompetidor: true })).rejects.toThrow(
      LimiteCompetidoresError
    );
  });

  it("agregar el MISMO ml_id_externo que ya estaba eliminado revive la fila, nunca la duplica", async () => {
    const { empresaId, usuarioId } = await crearEmpresaConUsuario();
    await conectarCuentaMl(empresaId);
    vi.stubGlobal("fetch", vi.fn(async () => respuestaJson({ id: "MCO111", title: "Reloj", status: "active" })));

    const primero = await agregarSeguimiento(empresaId, usuarioId, { tipo: "producto", link: "MCO111", esCompetidor: false });
    await eliminarSeguimiento(empresaId, primero.id);
    const revivido = await agregarSeguimiento(empresaId, usuarioId, { tipo: "producto", link: "MCO111", esCompetidor: true });

    expect(revivido.id).toBe(primero.id);
    expect(revivido.eliminadoTs).toBeNull();
    expect(revivido.esCompetidor).toBe(true);

    const activos = await dbComoEmpresa(empresaId, (tx) => tx.select().from(seguimientosMl).where(eq(seguimientosMl.empresaId, empresaId)));
    expect(activos).toHaveLength(1);
  });
});

// Issue #201 — resolverNombre() directo, sin pasar por agregarSeguimiento
// (sin cuenta/token real de por medio) — el fallback nunca es el id,
// siempre el placeholder explícito, para los 3 casos reales (item,
// product de catálogo, tienda).
describe("resolverNombre (issue #201)", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("producto (item): trae el título real cuando Mercado Libre lo deja ver", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => respuestaJson({ id: "MCO111", title: "Reloj digital", status: "active" })));
    expect(await resolverNombre("producto", "item", "MCO111", "token")).toBe("Reloj digital");
  });

  it("producto (item): placeholder, nunca el id, si Mercado Libre no deja ver el título", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => respuestaJson({}, 403)));
    expect(await resolverNombre("producto", "item", "MCO111", "token")).toBe(NOMBRE_PENDIENTE_PRIMERA_REVISION);
  });

  it("producto (catálogo): trae el nombre real; placeholder si Mercado Libre no lo deja ver", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => respuestaJson({ name: "Pulsera deportiva" })));
    expect(await resolverNombre("producto", "product", "MCO222", "token")).toBe("Pulsera deportiva");

    vi.unstubAllGlobals();
    vi.stubGlobal("fetch", vi.fn(async () => respuestaJson({}, 403)));
    expect(await resolverNombre("producto", "product", "MCO222", "token")).toBe(NOMBRE_PENDIENTE_PRIMERA_REVISION);
  });

  it("tienda: trae el nickname real; placeholder si Mercado Libre no lo deja ver", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => respuestaJson({ nickname: "TIENDA_REAL" })));
    expect(await resolverNombre("tienda", "seller", "123456", "token")).toBe("TIENDA_REAL");
  });

  it("nunca revienta: una falla de red también cae en el placeholder, nunca propaga ni usa el id", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("falla de red");
      })
    );
    expect(await resolverNombre("producto", "item", "MCO111", "token")).toBe(NOMBRE_PENDIENTE_PRIMERA_REVISION);
  });
});

// Issue #182 — la extensión ("Seguir en Zilonix") puede abrir el mismo
// link más de una vez; antes de agregar de nuevo (actions.ts), se usa
// esta función para avisar "ya existía" en vez de reinsertar/revivir
// sin necesidad.
describe("buscarSeguimientoActivoPorMlId (issue #182)", () => {
  it("encuentra el seguimiento activo con ese ml_id_externo", async () => {
    const { empresaId, usuarioId } = await crearEmpresaConUsuario();
    await conectarCuentaMl(empresaId);
    vi.stubGlobal("fetch", vi.fn(async () => respuestaJson({ id: "MCO111", title: "Reloj", status: "active" })));
    const seguimiento = await agregarSeguimiento(empresaId, usuarioId, { tipo: "producto", link: "MCO111", esCompetidor: false });
    vi.unstubAllGlobals();

    const encontrado = await buscarSeguimientoActivoPorMlId(empresaId, "MCO111");
    expect(encontrado?.id).toBe(seguimiento.id);
  });

  it("nunca encuentra uno ya eliminado", async () => {
    const { empresaId, usuarioId } = await crearEmpresaConUsuario();
    await conectarCuentaMl(empresaId);
    vi.stubGlobal("fetch", vi.fn(async () => respuestaJson({ id: "MCO111", title: "Reloj", status: "active" })));
    const seguimiento = await agregarSeguimiento(empresaId, usuarioId, { tipo: "producto", link: "MCO111", esCompetidor: false });
    vi.unstubAllGlobals();
    await eliminarSeguimiento(empresaId, seguimiento.id);

    expect(await buscarSeguimientoActivoPorMlId(empresaId, "MCO111")).toBeNull();
  });

  it("devuelve null si no existe ningún seguimiento con ese id en esta empresa", async () => {
    const { empresaId } = await crearEmpresaConUsuario();
    expect(await buscarSeguimientoActivoPorMlId(empresaId, "MCO999999")).toBeNull();
  });
});

describe("listarSeguimientosConUltimaFoto / obtenerDetalleSeguimiento (issue #175)", () => {
  it("lista solo los activos (nunca los eliminados), con la foto más reciente de cada uno", async () => {
    const { empresaId, usuarioId } = await crearEmpresaConUsuario();
    await conectarCuentaMl(empresaId);
    vi.stubGlobal("fetch", vi.fn(async () => respuestaJson({ id: "X", title: "X", status: "active" })));

    const activo = await agregarSeguimiento(empresaId, usuarioId, { tipo: "producto", link: "MCO111", esCompetidor: false });
    const eliminado = await agregarSeguimiento(empresaId, usuarioId, { tipo: "producto", link: "MCO222", esCompetidor: false });
    await eliminarSeguimiento(empresaId, eliminado.id);

    await dbComoEmpresa(empresaId, (tx) =>
      tx.insert(seguimientoFotos).values([
        { empresaId, seguimientoId: activo.id, fecha: new Date("2026-10-20"), precio: "100" },
        { empresaId, seguimientoId: activo.id, fecha: new Date("2026-10-21"), precio: "90" },
      ])
    );
    vi.unstubAllGlobals();

    const lista = await listarSeguimientosConUltimaFoto(empresaId);

    expect(lista).toHaveLength(1);
    expect(lista[0].seguimiento.id).toBe(activo.id);
    expect(Number(lista[0].ultimaFoto?.precio)).toBe(90); // la más reciente, no la primera
  });

  // Issue #195 — "comparativa": fotoAnterior (para precio/inventario/
  // vendidos "valor + delta" y "ventas hoy") y fotoHaceUnMes (para
  // "ventas ~30 días"), ambas relativas a la fecha de la ÚLTIMA foto —
  // nunca a la fecha real de hoy, para que esto no dependa de cuándo
  // corre la prueba.
  it("trae fotoAnterior (la foto justo antes de la última) y fotoHaceUnMes (la más cercana a 30 días antes, si hay alguna de al menos 25)", async () => {
    const { empresaId, usuarioId } = await crearEmpresaConUsuario();
    await conectarCuentaMl(empresaId);
    vi.stubGlobal("fetch", vi.fn(async () => respuestaJson({ id: "X", title: "X", status: "active" })));
    const seguimiento = await agregarSeguimiento(empresaId, usuarioId, { tipo: "producto", link: "MCO111", esCompetidor: false });
    vi.unstubAllGlobals();

    await dbComoEmpresa(empresaId, (tx) =>
      tx.insert(seguimientoFotos).values([
        { empresaId, seguimientoId: seguimiento.id, fecha: new Date("2026-09-20"), vendidos: 50 }, // 31 días antes de la última
        { empresaId, seguimientoId: seguimiento.id, fecha: new Date("2026-10-20"), vendidos: 90 }, // la anterior (ayer)
        { empresaId, seguimientoId: seguimiento.id, fecha: new Date("2026-10-21"), vendidos: 99 }, // la última (hoy)
      ])
    );

    const lista = await listarSeguimientosConUltimaFoto(empresaId);
    const fila = lista.find((f) => f.seguimiento.id === seguimiento.id);

    expect(fila?.ultimaFoto?.vendidos).toBe(99);
    expect(fila?.fotoAnterior?.vendidos).toBe(90);
    expect(fila?.fotoHaceUnMes?.vendidos).toBe(50);
  });

  it("sin suficiente historial (todo más reciente que 25 días) -> fotoHaceUnMes null, nunca la más vieja que haya", async () => {
    const { empresaId, usuarioId } = await crearEmpresaConUsuario();
    await conectarCuentaMl(empresaId);
    vi.stubGlobal("fetch", vi.fn(async () => respuestaJson({ id: "X", title: "X", status: "active" })));
    const seguimiento = await agregarSeguimiento(empresaId, usuarioId, { tipo: "producto", link: "MCO222", esCompetidor: false });
    vi.unstubAllGlobals();

    await dbComoEmpresa(empresaId, (tx) =>
      tx.insert(seguimientoFotos).values([
        { empresaId, seguimientoId: seguimiento.id, fecha: new Date("2026-10-15"), vendidos: 10 }, // 6 días antes
        { empresaId, seguimientoId: seguimiento.id, fecha: new Date("2026-10-21"), vendidos: 15 },
      ])
    );

    const lista = await listarSeguimientosConUltimaFoto(empresaId);
    const fila = lista.find((f) => f.seguimiento.id === seguimiento.id);

    expect(fila?.fotoAnterior?.vendidos).toBe(10);
    expect(fila?.fotoHaceUnMes).toBeNull();
  });

  it("obtenerDetalleSeguimiento trae el historial completo de fotos y las alertas, ordenadas", async () => {
    const { empresaId, usuarioId } = await crearEmpresaConUsuario();
    await conectarCuentaMl(empresaId);
    vi.stubGlobal("fetch", vi.fn(async () => respuestaJson({ id: "X", title: "X", status: "active" })));
    const seguimiento = await agregarSeguimiento(empresaId, usuarioId, { tipo: "producto", link: "MCO111", esCompetidor: false });
    vi.unstubAllGlobals();

    const [fotoAyer] = await dbComoEmpresa(empresaId, (tx) =>
      tx.insert(seguimientoFotos).values({ empresaId, seguimientoId: seguimiento.id, fecha: new Date("2026-10-20"), precio: "100" }).returning()
    );
    const [fotoHoy] = await dbComoEmpresa(empresaId, (tx) =>
      tx.insert(seguimientoFotos).values({ empresaId, seguimientoId: seguimiento.id, fecha: new Date("2026-10-21"), precio: "90" }).returning()
    );
    await dbComoEmpresa(empresaId, (tx) =>
      tx.insert(seguimientoAlertas).values({ empresaId, seguimientoId: seguimiento.id, fotoId: fotoHoy.id, tipo: "precio_bajo", detalle: { precioAnterior: 100, precioNuevo: 90, porcentaje: -10 } })
    );

    const detalle = await obtenerDetalleSeguimiento(empresaId, seguimiento.id);

    expect(detalle?.fotos.map((f) => f.id)).toEqual([fotoAyer.id, fotoHoy.id]); // más viejo primero
    expect(detalle?.alertas).toHaveLength(1);
    expect(detalle?.alertas[0].tipo).toBe("precio_bajo");
  });

  it("obtenerDetalleSeguimiento devuelve null si el seguimiento no existe o es de otra empresa", async () => {
    const { empresaId } = await crearEmpresaConUsuario();
    expect(await obtenerDetalleSeguimiento(empresaId, randomUUID())).toBeNull();
  });
});

function diasAtras(dias: number): Date {
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  d.setUTCDate(d.getUTCDate() - dias);
  return d;
}

// Issue #196 (apoya #195/#175) — capa de datos que Code 1 usa para las
// tarjetas "Hoy"/"~30 días" del panel.
describe("listarSeguimientosConFotosParaVentas (issue #196)", () => {
  it("trae ultimaFoto/fotoAnterior (las 2 más recientes) y fotoCerca30d (exacto a 30 días, dentro de la ventana)", async () => {
    const { empresaId, usuarioId } = await crearEmpresaConUsuario();
    await conectarCuentaMl(empresaId);
    vi.stubGlobal("fetch", vi.fn(async () => respuestaJson({ id: "X", title: "X", status: "active" })));
    const seguimiento = await agregarSeguimiento(empresaId, usuarioId, { tipo: "producto", link: "MCO111", esCompetidor: false });
    vi.unstubAllGlobals();

    const [fotoHace30] = await dbComoEmpresa(empresaId, (tx) =>
      tx.insert(seguimientoFotos).values({ empresaId, seguimientoId: seguimiento.id, fecha: diasAtras(30), vendidos: 100 }).returning()
    );
    const [fotoAyer] = await dbComoEmpresa(empresaId, (tx) =>
      tx.insert(seguimientoFotos).values({ empresaId, seguimientoId: seguimiento.id, fecha: diasAtras(1), vendidos: 210 }).returning()
    );
    const [fotoHoy] = await dbComoEmpresa(empresaId, (tx) =>
      tx.insert(seguimientoFotos).values({ empresaId, seguimientoId: seguimiento.id, fecha: diasAtras(0), vendidos: 220 }).returning()
    );

    const lista = await listarSeguimientosConFotosParaVentas(empresaId);
    const fila = lista.find((f) => f.seguimiento.id === seguimiento.id);

    expect(fila?.ultimaFoto?.id).toBe(fotoHoy.id);
    expect(fila?.fotoAnterior?.id).toBe(fotoAyer.id);
    expect(fila?.fotoCerca30d?.id).toBe(fotoHace30.id);
  });

  it("fotoCerca30d: null si ninguna foto cae en la ventana de 25-35 días (nunca aproxima con la más vieja disponible)", async () => {
    const { empresaId, usuarioId } = await crearEmpresaConUsuario();
    await conectarCuentaMl(empresaId);
    vi.stubGlobal("fetch", vi.fn(async () => respuestaJson({ id: "X", title: "X", status: "active" })));
    const seguimiento = await agregarSeguimiento(empresaId, usuarioId, { tipo: "producto", link: "MCO111", esCompetidor: false });
    vi.unstubAllGlobals();

    await dbComoEmpresa(empresaId, (tx) => tx.insert(seguimientoFotos).values({ empresaId, seguimientoId: seguimiento.id, fecha: diasAtras(0), vendidos: 10 }));
    // La única foto vieja queda FUERA de la ventana (40 días, no 25-35).
    await dbComoEmpresa(empresaId, (tx) => tx.insert(seguimientoFotos).values({ empresaId, seguimientoId: seguimiento.id, fecha: diasAtras(40), vendidos: 1 }));

    const lista = await listarSeguimientosConFotosParaVentas(empresaId);
    const fila = lista.find((f) => f.seguimiento.id === seguimiento.id);

    expect(fila?.fotoCerca30d).toBeNull();
  });

  it("fotoCerca30d: con varias candidatas en la ventana, elige la más cercana a 30 días exactos", async () => {
    const { empresaId, usuarioId } = await crearEmpresaConUsuario();
    await conectarCuentaMl(empresaId);
    vi.stubGlobal("fetch", vi.fn(async () => respuestaJson({ id: "X", title: "X", status: "active" })));
    const seguimiento = await agregarSeguimiento(empresaId, usuarioId, { tipo: "producto", link: "MCO111", esCompetidor: false });
    vi.unstubAllGlobals();

    const [masCerca] = await dbComoEmpresa(empresaId, (tx) =>
      tx.insert(seguimientoFotos).values({ empresaId, seguimientoId: seguimiento.id, fecha: diasAtras(28), vendidos: 50 }).returning()
    ); // distancia 2
    await dbComoEmpresa(empresaId, (tx) => tx.insert(seguimientoFotos).values({ empresaId, seguimientoId: seguimiento.id, fecha: diasAtras(33), vendidos: 1 })); // distancia 3

    const lista = await listarSeguimientosConFotosParaVentas(empresaId);
    const fila = lista.find((f) => f.seguimiento.id === seguimiento.id);

    expect(fila?.fotoCerca30d?.id).toBe(masCerca.id);
  });

  it("nunca lista un seguimiento eliminado", async () => {
    const { empresaId, usuarioId } = await crearEmpresaConUsuario();
    await conectarCuentaMl(empresaId);
    vi.stubGlobal("fetch", vi.fn(async () => respuestaJson({ id: "X", title: "X", status: "active" })));
    const seguimiento = await agregarSeguimiento(empresaId, usuarioId, { tipo: "producto", link: "MCO111", esCompetidor: false });
    vi.unstubAllGlobals();
    await eliminarSeguimiento(empresaId, seguimiento.id);

    const lista = await listarSeguimientosConFotosParaVentas(empresaId);

    expect(lista.some((f) => f.seguimiento.id === seguimiento.id)).toBe(false);
  });
});

// Issue #222 — el puente real entre Seguimiento e Investigación:
// Investigación pasa el mismo `itemId` que usa como `mlIdExterno` acá.
describe("buscarMedicionSiExiste (issue #222)", () => {
  it("producto no seguido: null, nunca una medición inventada", async () => {
    const { empresaId } = await crearEmpresaConUsuario();
    expect(await buscarMedicionSiExiste(empresaId, "MCO111")).toBeNull();
  });

  it("seguido pero sin ninguna foto todavía: null", async () => {
    const { empresaId, usuarioId } = await crearEmpresaConUsuario();
    await conectarCuentaMl(empresaId);
    vi.stubGlobal("fetch", vi.fn(async () => respuestaJson({ id: "X", title: "X", status: "active" })));
    await agregarSeguimiento(empresaId, usuarioId, { tipo: "producto", link: "MCO111", esCompetidor: false });
    vi.unstubAllGlobals();

    expect(await buscarMedicionSiExiste(empresaId, "MCO111")).toBeNull();
  });

  it("seguido, pero sin ninguna foto en la ventana de 5-9 días: null (nunca aproxima con una más vieja/nueva)", async () => {
    const { empresaId, usuarioId } = await crearEmpresaConUsuario();
    await conectarCuentaMl(empresaId);
    vi.stubGlobal("fetch", vi.fn(async () => respuestaJson({ id: "X", title: "X", status: "active" })));
    const seguimiento = await agregarSeguimiento(empresaId, usuarioId, { tipo: "producto", link: "MCO111", esCompetidor: false });
    vi.unstubAllGlobals();

    await dbComoEmpresa(empresaId, (tx) => tx.insert(seguimientoFotos).values({ empresaId, seguimientoId: seguimiento.id, fecha: diasAtras(0), vendidos: 50 }));
    // La única foto vieja queda FUERA de la ventana (15 días, no 5-9).
    await dbComoEmpresa(empresaId, (tx) => tx.insert(seguimientoFotos).values({ empresaId, seguimientoId: seguimiento.id, fecha: diasAtras(15), vendidos: 10 }));

    expect(await buscarMedicionSiExiste(empresaId, "MCO111")).toBeNull();
  });

  it("seguido con una foto real dentro de la ventana de 5-9 días: resta medida real (ventasDelPeriodo)", async () => {
    const { empresaId, usuarioId } = await crearEmpresaConUsuario();
    await conectarCuentaMl(empresaId);
    vi.stubGlobal("fetch", vi.fn(async () => respuestaJson({ id: "X", title: "X", status: "active" })));
    const seguimiento = await agregarSeguimiento(empresaId, usuarioId, { tipo: "producto", link: "MCO111", esCompetidor: false });
    vi.unstubAllGlobals();

    await dbComoEmpresa(empresaId, (tx) => tx.insert(seguimientoFotos).values({ empresaId, seguimientoId: seguimiento.id, fecha: diasAtras(7), vendidos: 100 }));
    await dbComoEmpresa(empresaId, (tx) => tx.insert(seguimientoFotos).values({ empresaId, seguimientoId: seguimiento.id, fecha: diasAtras(0), vendidos: 130 }));

    expect(await buscarMedicionSiExiste(empresaId, "MCO111")).toBe(30);
  });

  it("con varias candidatas en la ventana, elige la más cercana a 7 días exactos (mismo criterio que fotoCerca30d)", async () => {
    const { empresaId, usuarioId } = await crearEmpresaConUsuario();
    await conectarCuentaMl(empresaId);
    vi.stubGlobal("fetch", vi.fn(async () => respuestaJson({ id: "X", title: "X", status: "active" })));
    const seguimiento = await agregarSeguimiento(empresaId, usuarioId, { tipo: "producto", link: "MCO111", esCompetidor: false });
    vi.unstubAllGlobals();

    await dbComoEmpresa(empresaId, (tx) => tx.insert(seguimientoFotos).values({ empresaId, seguimientoId: seguimiento.id, fecha: diasAtras(6), vendidos: 90 })); // distancia 1, la más cerca
    await dbComoEmpresa(empresaId, (tx) => tx.insert(seguimientoFotos).values({ empresaId, seguimientoId: seguimiento.id, fecha: diasAtras(9), vendidos: 10 })); // distancia 2
    await dbComoEmpresa(empresaId, (tx) => tx.insert(seguimientoFotos).values({ empresaId, seguimientoId: seguimiento.id, fecha: diasAtras(0), vendidos: 120 }));

    expect(await buscarMedicionSiExiste(empresaId, "MCO111")).toBe(30); // 120 - 90, nunca 120 - 10
  });

  it("resultado negativo (vendidos nunca debería bajar): null, nunca un negativo fabricado", async () => {
    const { empresaId, usuarioId } = await crearEmpresaConUsuario();
    await conectarCuentaMl(empresaId);
    vi.stubGlobal("fetch", vi.fn(async () => respuestaJson({ id: "X", title: "X", status: "active" })));
    const seguimiento = await agregarSeguimiento(empresaId, usuarioId, { tipo: "producto", link: "MCO111", esCompetidor: false });
    vi.unstubAllGlobals();

    await dbComoEmpresa(empresaId, (tx) => tx.insert(seguimientoFotos).values({ empresaId, seguimientoId: seguimiento.id, fecha: diasAtras(7), vendidos: 200 }));
    await dbComoEmpresa(empresaId, (tx) => tx.insert(seguimientoFotos).values({ empresaId, seguimientoId: seguimiento.id, fecha: diasAtras(0), vendidos: 100 }));

    expect(await buscarMedicionSiExiste(empresaId, "MCO111")).toBeNull();
  });

  it("nunca mide contra un seguimiento eliminado (mismo criterio que buscarSeguimientoActivoPorMlId)", async () => {
    const { empresaId, usuarioId } = await crearEmpresaConUsuario();
    await conectarCuentaMl(empresaId);
    vi.stubGlobal("fetch", vi.fn(async () => respuestaJson({ id: "X", title: "X", status: "active" })));
    const seguimiento = await agregarSeguimiento(empresaId, usuarioId, { tipo: "producto", link: "MCO111", esCompetidor: false });
    vi.unstubAllGlobals();
    await dbComoEmpresa(empresaId, (tx) => tx.insert(seguimientoFotos).values({ empresaId, seguimientoId: seguimiento.id, fecha: diasAtras(7), vendidos: 100 }));
    await dbComoEmpresa(empresaId, (tx) => tx.insert(seguimientoFotos).values({ empresaId, seguimientoId: seguimiento.id, fecha: diasAtras(0), vendidos: 130 }));
    await eliminarSeguimiento(empresaId, seguimiento.id);

    expect(await buscarMedicionSiExiste(empresaId, "MCO111")).toBeNull();
  });
});

describe("listarAlertasDelDia / marcarAlertaLeida (issue #175)", () => {
  it("solo trae alertas de HOY, nunca de días anteriores", async () => {
    const { empresaId, usuarioId } = await crearEmpresaConUsuario();
    await conectarCuentaMl(empresaId);
    vi.stubGlobal("fetch", vi.fn(async () => respuestaJson({ id: "X", title: "Producto de prueba", status: "active" })));
    const seguimiento = await agregarSeguimiento(empresaId, usuarioId, { tipo: "producto", link: "MCO111", esCompetidor: false });
    vi.unstubAllGlobals();

    const [fotoVieja] = await dbComoEmpresa(empresaId, (tx) =>
      tx.insert(seguimientoFotos).values({ empresaId, seguimientoId: seguimiento.id, fecha: new Date("2020-01-01"), precio: "100" }).returning()
    );
    const [fotoHoy] = await dbComoEmpresa(empresaId, (tx) =>
      tx.insert(seguimientoFotos).values({ empresaId, seguimientoId: seguimiento.id, fecha: new Date(), precio: "90" }).returning()
    );
    await dbComoEmpresa(empresaId, (tx) =>
      tx.insert(seguimientoAlertas).values([
        { empresaId, seguimientoId: seguimiento.id, fotoId: fotoVieja.id, tipo: "precio_bajo", detalle: {}, creadoTs: new Date("2020-01-01") },
        { empresaId, seguimientoId: seguimiento.id, fotoId: fotoHoy.id, tipo: "precio_bajo", detalle: {} },
      ])
    );

    const alertasDeHoy = await listarAlertasDelDia(empresaId);

    expect(alertasDeHoy).toHaveLength(1);
    expect(alertasDeHoy[0].alerta.fotoId).toBe(fotoHoy.id);
    expect(alertasDeHoy[0].nombreSeguimiento).toBe("Producto de prueba");
  });

  it("marcarAlertaLeida fija leida_ts, nunca borra la alerta", async () => {
    const { empresaId, usuarioId } = await crearEmpresaConUsuario();
    await conectarCuentaMl(empresaId);
    vi.stubGlobal("fetch", vi.fn(async () => respuestaJson({ id: "X", title: "X", status: "active" })));
    const seguimiento = await agregarSeguimiento(empresaId, usuarioId, { tipo: "producto", link: "MCO111", esCompetidor: false });
    vi.unstubAllGlobals();

    const [foto] = await dbComoEmpresa(empresaId, (tx) =>
      tx.insert(seguimientoFotos).values({ empresaId, seguimientoId: seguimiento.id, fecha: new Date(), precio: "90" }).returning()
    );
    const [alerta] = await dbComoEmpresa(empresaId, (tx) =>
      tx.insert(seguimientoAlertas).values({ empresaId, seguimientoId: seguimiento.id, fotoId: foto.id, tipo: "precio_bajo", detalle: {} }).returning()
    );

    await marcarAlertaLeida(empresaId, alerta.id);

    const [actualizada] = await dbComoEmpresa(empresaId, (tx) => tx.select().from(seguimientoAlertas).where(eq(seguimientoAlertas.id, alerta.id)));
    expect(actualizada.leidaTs).not.toBeNull();
  });
});
