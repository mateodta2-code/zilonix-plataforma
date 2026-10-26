import { randomUUID } from "crypto";
import { and, eq, isNull, lt, ne, or } from "drizzle-orm";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { dbComoEmpresa } from "@/db/empresa-context";
import { db } from "@/db/index";
import { dbTrabajadorSeguimiento } from "@/db/trabajador-seguimiento-context";
import { cuentasMl, empresas, seguimientoAlertas, seguimientoFotos, seguimientosMl, usuarios } from "@/db/schema";
import { cifrarToken } from "@/lib/cifrado";
import { NOMBRE_PENDIENTE_PRIMERA_REVISION } from "@/lib/seguimiento/seguimientos";
import { obtenerSeguimientosPendientesDeHoy, revisarAhoraUnSeguimiento, revisarSeguimientosDelDia } from "./revisionDiariaSeguimiento";

// Issue #175 — prueba real contra Postgres (mismo criterio que
// lib/ml/trabajador.test.ts): dbTrabajadorSeguimiento (DATABASE_URL_SEGUIMIENTO)
// lee seguimientos de CUALQUIER empresa (cross-empresa, a propósito —
// por eso esta prueba SÍ necesita la conexión real, al revés de
// lib/trabajos/leerConReintento429.test.ts, que la mockea porque nunca
// la toca). dbComoEmpresa/app_user hace el resto una vez resuelta la
// empresa. Solo el fetch a Mercado Libre se simula.
function respuestaJson(data: unknown, status = 200) {
  return { ok: status >= 200 && status < 300, status, json: async () => data, text: async () => JSON.stringify(data) } as Response;
}

async function crearEmpresaConUsuario(prefijo: string) {
  const empresaId = randomUUID();
  await dbComoEmpresa(empresaId, (tx) => tx.insert(empresas).values({ id: empresaId, nombre: `Empresa ${prefijo}`, nit: `TEST-${prefijo}-${empresaId.slice(0, 8)}` }));
  const [usuario] = await db.insert(usuarios).values({ email: `prueba-${prefijo}-${empresaId}@zilonix.test`, nombre: "Usuario de prueba" }).returning({ id: usuarios.id });
  return { empresaId, usuarioId: usuario.id };
}

// Issue real, encontrado en CI: obtenerFotoItemMl exige /^MCO\d+$/ —
// un id armado con randomUUID() puede traer letras (a-f) y entonces
// NUNCA matchea, leerFotoSeguimiento cae a fotoVacia() (vendidos/precio
// null) sin que el trabajo lo marque como fallido (no es un error, es
// un ítem "sin datos"). Solo dígitos después de MCO, nunca un hex —
// Date.now() + un contador incremental (nunca aleatorio) para que dos
// llamadas en el mismo milisegundo tampoco choquen.
let contadorMlId = 0;
function nuevoMlId() {
  contadorMlId += 1;
  return `MCO${Date.now()}${contadorMlId.toString().padStart(4, "0")}`;
}

// Issue real, encontrado en CI: obtenerSeguimientosPendientesDeHoy() es
// cross-empresa (TAMAÑO_LOTE=50, sin filtro por empresa) — en una base
// de CI con muchos seguimientos viejos de otras suites sin
// ultima_revision_ts, esos ahogaban el lote de cualquier prueba que
// llamara revisarSeguimientosDelDia() y causaban timeout. Antes de
// probar el lote de una suite puntual, se marca como revisado HOY a
// todo lo demás pendiente — deja el lote con solo lo que la suite
// insertó.
async function aislarLotePara(seguimientoId: string) {
  const hoy = new Date();
  hoy.setUTCHours(0, 0, 0, 0);
  await dbTrabajadorSeguimiento
    .update(seguimientosMl)
    .set({ ultimaRevisionTs: new Date() })
    .where(
      and(
        isNull(seguimientosMl.eliminadoTs),
        ne(seguimientosMl.id, seguimientoId),
        or(isNull(seguimientosMl.ultimaRevisionTs), lt(seguimientosMl.ultimaRevisionTs, hoy))
      )
    );
}

describe("revisarSeguimientosDelDia (issue #175)", () => {
  const empresaId = randomUUID();
  let seguimientoId: string;
  const itemId = nuevoMlId();

  beforeAll(async () => {
    await dbComoEmpresa(empresaId, (tx) =>
      tx.insert(empresas).values({ id: empresaId, nombre: "Empresa revisión diaria", nit: `TEST-REV-${empresaId.slice(0, 8)}` })
    );
    await dbComoEmpresa(empresaId, (tx) =>
      tx.insert(cuentasMl).values({
        empresaId,
        cuentaIdExterna: `${Date.now()}`,
        nickname: "VENDEDOR_REVISION",
        accessTokenCifrado: cifrarToken("access-vigente"),
        refreshTokenCifrado: cifrarToken("refresh"),
        tokenExpiraTs: new Date(Date.now() + 3600_000), // vigente — no debería intentar renovar
      })
    );

    // usuarios no lleva RLS (tarea 1.3) — se inserta con la conexión
    // normal de app_user, igual que db/test-utils/aislamiento.ts.
    const [usuario] = await db
      .insert(usuarios)
      .values({ email: `prueba-revision-diaria-${empresaId}@zilonix.test`, nombre: "Usuario de prueba" })
      .returning({ id: usuarios.id });

    const [seguimiento] = await dbComoEmpresa(empresaId, (tx) =>
      tx
        .insert(seguimientosMl)
        .values({
          empresaId,
          tipo: "producto",
          recursoMl: "item",
          mlIdExterno: itemId,
          nombre: "Producto de prueba",
          linkOriginal: "https://articulo.mercadolibre.com.co/MCO-1",
          creadoPor: usuario.id,
        })
        .returning({ id: seguimientosMl.id })
    );
    seguimientoId = seguimiento.id;
    await aislarLotePara(seguimientoId);

    // Foto de "ayer" insertada directo (nunca a través del trabajo):
    // precio 100, vendidos 10 — la de "hoy" (simulada con fetch abajo)
    // trae precio 80 y vendidos 15, para disparar precio_bajo y
    // vendio_unidades al compararlas.
    const ayer = new Date();
    ayer.setUTCHours(0, 0, 0, 0);
    ayer.setUTCDate(ayer.getUTCDate() - 1);
    await dbComoEmpresa(empresaId, (tx) =>
      tx.insert(seguimientoFotos).values({
        empresaId,
        seguimientoId,
        fecha: ayer,
        precio: "100",
        estado: "active",
        enCatalogo: false,
        vendidos: 10,
      })
    );
  });

  afterEach(() => vi.unstubAllGlobals());

  it("crea la foto de hoy y las alertas (precio_bajo, vendio_unidades) comparando con la de ayer", async () => {
    // Issue real (CI, tercera vuelta): vitest corre archivos de prueba
    // en paralelo — otra suite (ej. lib/seguimiento/seguimientos.test.ts)
    // puede insertar un seguimiento NUEVO en el tiempo entre el
    // beforeAll y este it, y ese sí entra al lote cross-empresa de
    // obtenerSeguimientosPendientesDeHoy(). aislarLotePara() solo en
    // beforeAll no alcanza — hay que repetirlo al INICIO de cada it que
    // llama revisarSeguimientosDelDia, lo más cerca posible de la
    // llamada real, para achicar esa ventana todo lo posible.
    await aislarLotePara(seguimientoId);

    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        respuestaJson({
          price: 80,
          sold_quantity: 15,
          status: "active",
          catalog_listing: false,
        })
      )
    );

    const resultado = await revisarSeguimientosDelDia();

    // Nunca fallidos===0: un seguimiento ajeno insertado por otra
    // suite en la ventana de la carrera de arriba SÍ puede fallar acá
    // (sin cuenta ML) sin que sea un problema de ESTA prueba — lo único
    // que de verdad importa es que el propio seguimiento de esta suite
    // se procesó bien (se confirma abajo con la foto/alertas reales).
    expect(resultado.procesados).toBeGreaterThanOrEqual(1);
    expect(resultado.fallidos).toBeLessThan(resultado.activos);

    const hoy = new Date();
    hoy.setUTCHours(0, 0, 0, 0);
    const [fotoHoy] = await dbComoEmpresa(empresaId, (tx) =>
      tx.select().from(seguimientoFotos).where(and(eq(seguimientoFotos.seguimientoId, seguimientoId), eq(seguimientoFotos.fecha, hoy)))
    );
    expect(fotoHoy).toBeDefined();
    expect(fotoHoy.vendidos).toBe(15);
    // Issue real (CI): con un ml_id_externo que matcheaba /^MCO\d+$/
    // con letras por accidente, obtenerFotoItemMl devolvía null y esta
    // foto quedaba con precio/vendidos null sin que fallidos lo
    // delatara — precio es numeric, drizzle lo devuelve como string.
    expect(Number(fotoHoy.precio)).toBe(80);

    const alertas = await dbComoEmpresa(empresaId, (tx) => tx.select().from(seguimientoAlertas).where(eq(seguimientoAlertas.seguimientoId, seguimientoId)));
    expect(alertas.map((a) => a.tipo).sort()).toEqual(["precio_bajo", "vendio_unidades"]);

    const [seguimientoActualizado] = await dbComoEmpresa(empresaId, (tx) => tx.select().from(seguimientosMl).where(eq(seguimientosMl.id, seguimientoId)));
    expect(seguimientoActualizado.ultimaRevisionTs).not.toBeNull();
  });

  // Issue #175 — con el filtro nuevo (punto 2), un seguimiento ya
  // revisado hoy ni siquiera entra al lote de la segunda corrida — la
  // protección contra duplicar la foto del día pasa a ser, en la
  // práctica, el filtro mismo; el índice único seguimiento_id+fecha
  // (ver db/rls-seguimiento.test.ts) sigue de respaldo por si algún
  // día el filtro se rompe.
  it(
    "corrida repetida el mismo día: el seguimiento ya no entra al lote, nunca duplica la foto",
    async () => {
      // Mismo motivo que en el it anterior: aislar de nuevo acá, lo
      // más cerca posible de la llamada real, por la carrera con otras
      // suites insertando seguimientos en paralelo.
      await aislarLotePara(seguimientoId);
      vi.stubGlobal("fetch", vi.fn(async () => respuestaJson({ price: 999, status: "active" }))); // si duplicara, este precio lo delataría

      await revisarSeguimientosDelDia();

      const hoy = new Date();
      hoy.setUTCHours(0, 0, 0, 0);
      const fotosDeHoy = await dbComoEmpresa(empresaId, (tx) =>
        tx.select().from(seguimientoFotos).where(and(eq(seguimientoFotos.seguimientoId, seguimientoId), eq(seguimientoFotos.fecha, hoy)))
      );
      expect(fotosDeHoy).toHaveLength(1);
      expect(Number(fotosDeHoy[0].precio)).toBe(80); // la de la corrida anterior, nunca 999
    },
    15000 // el lote cross-empresa puede traer varios seguimientos ajenos recién insertados por otras suites en paralelo — cada uno paga su propia espera/reintento antes de fallar
  );
});

// Issue #175 — si un seguimiento fallido (ej. empresa sin cuenta ML
// conectada) NUNCA marca ultima_revision_ts, el orden ASC NULLS FIRST
// lo deja al frente del lote para siempre — ahoga los 50 cupos en
// cada corrida siguiente. Issue #250, punto C — una primera versión
// de este punto quitó esa marca pensando que hacía falta para
// reintentar más seguido; Pablo corrigió eso en la revisión del PR
// #253: con la ventana de 6h (punto E), SÍ marcar ultima_revision_ts
// ya significa "reintentar en la próxima ventana" (dos veces al día),
// nunca "esperar hasta mañana" como antes de ese punto — así que la
// protección real de #175 se mantiene, sin perder el reintento rápido.
describe("revisarSeguimientosDelDia — un fallido SÍ marca ultima_revision_ts, nunca ahoga el lote (issue #175 + #250 punto C)", () => {
  let empresaId: string;
  let seguimientoId: string;

  beforeAll(async () => {
    const creado = await crearEmpresaConUsuario("SIN-CUENTA");
    empresaId = creado.empresaId;

    // A propósito: ninguna cuenta ML conectada para esta empresa —
    // revisarUnSeguimiento debe lanzar "La empresa no tiene ninguna
    // cuenta de Mercado Libre conectada.".
    const [seguimiento] = await dbComoEmpresa(empresaId, (tx) =>
      tx
        .insert(seguimientosMl)
        .values({
          empresaId,
          tipo: "producto",
          recursoMl: "item",
          mlIdExterno: nuevoMlId(),
          nombre: "Sin cuenta ML",
          linkOriginal: "https://x",
          creadoPor: creado.usuarioId,
        })
        .returning({ id: seguimientosMl.id })
    );
    seguimientoId = seguimiento.id;
    await aislarLotePara(seguimientoId);
  });

  it("cuenta como fallido Y queda con ultima_revision_ts no null, y no vuelve a aparecer en el lote de hoy (dentro de las 6h)", async () => {
    // Mismo motivo que en las pruebas de arriba: aislar de nuevo acá
    // (dejando SOLO este seguimiento pendiente), lo más cerca posible
    // de la llamada real, por la carrera con otras suites en paralelo.
    await aislarLotePara(seguimientoId);

    const resultado = await revisarSeguimientosDelDia();

    expect(resultado.fallidos).toBeGreaterThanOrEqual(1);

    const [actualizado] = await dbComoEmpresa(empresaId, (tx) => tx.select().from(seguimientosMl).where(eq(seguimientosMl.id, seguimientoId)));
    expect(actualizado.ultimaRevisionTs).not.toBeNull();

    const pendientes = await obtenerSeguimientosPendientesDeHoy();
    expect(pendientes.some((p) => p.id === seguimientoId)).toBe(false);
  });
});

// Issue #250, punto C — "agregar recurso_ml, ml_id_externo y status
// HTTP al log (nunca el token)": antes el console.error solo traía el
// id del seguimiento y el mensaje — sin saber QUÉ recurso de Mercado
// Libre falló ni con qué status real, cada fallo había que
// diagnosticarlo a ciegas.
describe("revisarSeguimientosDelDia — el log de un fallido trae recurso_ml/ml_id_externo/status, nunca el token (issue #250, punto C)", () => {
  let empresaId: string;
  let seguimientoId: string;
  let itemId: string;

  beforeAll(async () => {
    const creado = await crearEmpresaConUsuario("LOG-ENRIQUECIDO");
    empresaId = creado.empresaId;
    await dbComoEmpresa(empresaId, (tx) =>
      tx.insert(cuentasMl).values({
        empresaId,
        cuentaIdExterna: `${Date.now()}${Math.floor(Math.random() * 10_000)}`,
        nickname: "VENDEDOR_LOG",
        accessTokenCifrado: cifrarToken("access-secreto-nunca-en-el-log"),
        refreshTokenCifrado: cifrarToken("refresh"),
        tokenExpiraTs: new Date(Date.now() + 3600_000), // vigente — no debería intentar renovar
      })
    );
    itemId = nuevoMlId();
    const [seguimiento] = await dbComoEmpresa(empresaId, (tx) =>
      tx
        .insert(seguimientosMl)
        .values({
          empresaId,
          tipo: "producto",
          recursoMl: "item",
          mlIdExterno: itemId,
          nombre: "Producto con 401 real",
          linkOriginal: "https://x",
          creadoPor: creado.usuarioId,
        })
        .returning({ id: seguimientosMl.id })
    );
    seguimientoId = seguimiento.id;
  });

  afterEach(() => vi.unstubAllGlobals());

  it("un 401 real de Mercado Libre (token ya no válido) queda en el log con recurso_ml, ml_id_externo y HTTP 401 — nunca el token", async () => {
    await aislarLotePara(seguimientoId);
    // obtenerFotoItemMl (lib/ml/cliente.ts) NO tolera 401 — propaga
    // MlNoAutorizadoError tal cual, mismo criterio que el resto del
    // archivo (401 siempre significa "hay que reconectar la cuenta").
    vi.stubGlobal("fetch", vi.fn(async () => respuestaJson({}, 401)));
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const resultado = await revisarSeguimientosDelDia();
    expect(resultado.fallidos).toBeGreaterThanOrEqual(1);

    const lineaDeEsteSeguimiento = errorSpy.mock.calls.find(([linea]) => typeof linea === "string" && linea.includes(seguimientoId));
    expect(lineaDeEsteSeguimiento).toBeDefined();
    const [linea] = lineaDeEsteSeguimiento as [string];
    expect(linea).toContain("recurso_ml=item");
    expect(linea).toContain(`ml_id_externo=${itemId}`);
    expect(linea).toContain("HTTP 401");
    expect(linea).not.toContain("access-secreto-nunca-en-el-log");

    errorSpy.mockRestore();
  });
});

// Issue #196 (histórico) + corrección de Pablo al punto 3 del #250
// (revisión del PR #253) — antes, cuando el lote alcanzaba un
// seguimiento que ya tenía foto de hoy (ronda de la tarde sobre uno
// que la madrugada ya procesó, o una corrida manual repetida),
// llamaba a Mercado Libre igual y descartaba el resultado con
// onConflictDoNothing ("saltado") — una llamada real gastada para
// nada. Ahora ACTUALIZA esa fila con lo más reciente de la API
// (precio, estado, etc.) y genera alertas contra la foto de ayer,
// SIN tocar nunca inventarioDisponible/vendidos/publicaciones — las
// mismas columnas que issue #251 reusa para lo que lee la extensión
// (esa rama no está mergeada acá todavía, pero esta ronda tiene que
// ser segura para cuando lo esté).
describe("revisarSeguimientosDelDia — ya hay foto de hoy: actualiza los campos de API, nunca duplica ni toca los de la extensión (issue #196 + corrección de Pablo al #250 punto 3)", () => {
  let empresaId: string;
  let seguimientoId: string;

  beforeAll(async () => {
    const creado = await crearEmpresaConUsuario("RONDA-TARDE");
    empresaId = creado.empresaId;
    await dbComoEmpresa(empresaId, (tx) =>
      tx.insert(cuentasMl).values({
        empresaId,
        cuentaIdExterna: `${Date.now()}${Math.floor(Math.random() * 10_000)}`,
        nickname: "VENDEDOR_RONDA_TARDE",
        accessTokenCifrado: cifrarToken("access-vigente"),
        refreshTokenCifrado: cifrarToken("refresh"),
        tokenExpiraTs: new Date(Date.now() + 3600_000),
      })
    );

    const [seguimiento] = await dbComoEmpresa(empresaId, (tx) =>
      tx
        .insert(seguimientosMl)
        .values({
          empresaId,
          tipo: "producto",
          recursoMl: "item",
          mlIdExterno: nuevoMlId(),
          nombre: "Ya tiene foto de hoy",
          linkOriginal: "https://x",
          creadoPor: creado.usuarioId,
        })
        .returning({ id: seguimientosMl.id })
    );
    seguimientoId = seguimiento.id;

    const ayer = new Date();
    ayer.setUTCHours(0, 0, 0, 0);
    ayer.setUTCDate(ayer.getUTCDate() - 1);
    await dbComoEmpresa(empresaId, (tx) => tx.insert(seguimientoFotos).values({ empresaId, seguimientoId, fecha: ayer, precio: "100", estado: "active", vendidos: 3 }));

    // A propósito: una foto de HOY insertada directo (simula lo que la
    // madrugada ya guardó) — con inventarioDisponible/vendidos puestos
    // a mano, distintos de lo que traería el mock de abajo, para
    // confirmar que la ronda de la tarde NUNCA los toca.
    const hoy = new Date();
    hoy.setUTCHours(0, 0, 0, 0);
    await dbComoEmpresa(empresaId, (tx) =>
      tx.insert(seguimientoFotos).values({ empresaId, seguimientoId, fecha: hoy, precio: "100", estado: "active", inventarioDisponible: 7, vendidos: 3 })
    );
  });

  afterEach(() => vi.unstubAllGlobals());

  it("actualiza precio con lo más reciente de la API, genera alerta contra ayer, nunca duplica la fila ni toca inventarioDisponible/vendidos", async () => {
    await aislarLotePara(seguimientoId);
    // Precio bajó de 100 (ayer) a 50 — tiene que generar precio_bajo
    // comparando la fila de HOY ya actualizada contra la de ayer.
    vi.stubGlobal("fetch", vi.fn(async () => respuestaJson({ price: 50, status: "active" })));

    const resultado = await revisarSeguimientosDelDia();

    expect(resultado.procesados).toBeGreaterThanOrEqual(1);
    expect(resultado.alertasCreadas).toBeGreaterThanOrEqual(1);

    const hoy = new Date();
    hoy.setUTCHours(0, 0, 0, 0);
    const fotosDeHoy = await dbComoEmpresa(empresaId, (tx) =>
      tx.select().from(seguimientoFotos).where(and(eq(seguimientoFotos.seguimientoId, seguimientoId), eq(seguimientoFotos.fecha, hoy)))
    );
    expect(fotosDeHoy).toHaveLength(1); // nunca duplica la fila
    expect(Number(fotosDeHoy[0].precio)).toBe(50); // actualizado con lo más reciente de la API
    expect(fotosDeHoy[0].inventarioDisponible).toBe(7); // nunca tocado — campo que reusa la extensión (#251)
    expect(fotosDeHoy[0].vendidos).toBe(3); // nunca tocado — campo que reusa la extensión (#251)

    const alertas = await dbComoEmpresa(empresaId, (tx) => tx.select().from(seguimientoAlertas).where(eq(seguimientoAlertas.seguimientoId, seguimientoId)));
    expect(alertas.some((a) => a.tipo === "precio_bajo")).toBe(true);
  });

  it("logea UN resumen de lote con los conteos reales (procesados/saltados/con error), sin ids ni tokens", async () => {
    await aislarLotePara(seguimientoId);
    vi.stubGlobal("fetch", vi.fn(async () => respuestaJson({ price: 999, status: "active" })));
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    const resultado = await revisarSeguimientosDelDia();

    const lineaDeLote = logSpy.mock.calls.find(([linea]) => typeof linea === "string" && linea.includes("lote del día"));
    expect(lineaDeLote).toBeDefined();
    const [linea] = lineaDeLote as [string];
    expect(linea).toContain(`${resultado.activos} activos`);
    expect(linea).toContain(`${resultado.procesados} procesados`);
    expect(linea).toContain(`${resultado.saltados} saltados`);
    expect(linea).toContain(`${resultado.fallidos} con error`);
    // Nunca el id del seguimiento ni ningún token/respuesta cruda de ML.
    expect(linea).not.toContain(seguimientoId);
    expect(linea).not.toContain("access-vigente");

    logSpy.mockRestore();
  });
});

// Issue #201 — bug real en staging: si agregarSeguimiento() no pudo
// resolver el nombre real ese instante, quedaba el id para siempre; la
// revisión diaria tiene que corregirlo apenas pueda, con un token ya
// confirmado vigente.
//
// Bug real de CI encontrado después (mismo issue): los dos tests de
// abajo compartían UN solo seguimiento creado en un beforeAll — el
// primer test actualizaba su nombre al real Y marcaba
// ultima_revision_ts, así que el segundo test arrancaba con el nombre
// YA resuelto (nunca entraba a reintentar, el chequeo
// `nombre === NOMBRE_PENDIENTE_PRIMERA_REVISION` ya daba falso) y,
// encima, el seguimiento ya no aparecía en el lote de ese mismo día
// (0 activos). Cada test ahora crea su PROPIA empresa/cuenta/
// seguimiento con el placeholder, aislado del otro — nunca un fixture
// compartido entre dos corridas de revisarSeguimientosDelDia.
describe("revisarSeguimientosDelDia — resuelve el nombre pendiente en la primera revisión (issue #201)", () => {
  afterEach(() => vi.unstubAllGlobals());

  async function crearSeguimientoPendiente(prefijo: string) {
    const creado = await crearEmpresaConUsuario(prefijo);
    await dbComoEmpresa(creado.empresaId, (tx) =>
      tx.insert(cuentasMl).values({
        empresaId: creado.empresaId,
        cuentaIdExterna: `${Date.now()}${Math.floor(Math.random() * 10_000)}`,
        nickname: `VENDEDOR_${prefijo}`,
        accessTokenCifrado: cifrarToken("access-vigente"),
        refreshTokenCifrado: cifrarToken("refresh"),
        tokenExpiraTs: new Date(Date.now() + 3600_000),
      })
    );

    const [seguimiento] = await dbComoEmpresa(creado.empresaId, (tx) =>
      tx
        .insert(seguimientosMl)
        .values({
          empresaId: creado.empresaId,
          tipo: "producto",
          recursoMl: "item",
          mlIdExterno: nuevoMlId(),
          nombre: NOMBRE_PENDIENTE_PRIMERA_REVISION, // a propósito: nunca se pudo resolver al agregar
          linkOriginal: "https://x",
          creadoPor: creado.usuarioId,
        })
        .returning()
    );
    return { empresaId: creado.empresaId, seguimientoId: seguimiento.id };
  }

  it("si Mercado Libre deja ver el título esta vez, actualiza el nombre real (nunca se queda pegado al placeholder)", async () => {
    const { empresaId, seguimientoId } = await crearSeguimientoPendiente("NOMBRE-PENDIENTE-OK");
    await aislarLotePara(seguimientoId);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => respuestaJson({ id: "MCO111", title: "Título real recién resuelto", price: 100, sold_quantity: 5, status: "active" }))
    );

    await revisarSeguimientosDelDia();

    const [actualizado] = await dbComoEmpresa(empresaId, (tx) => tx.select().from(seguimientosMl).where(eq(seguimientosMl.id, seguimientoId)));
    expect(actualizado.nombre).toBe("Título real recién resuelto");
  });

  it("si Mercado Libre sigue sin dejar verlo, el nombre se queda en el placeholder (nunca se pisa con el id ni con basura)", async () => {
    const { empresaId, seguimientoId } = await crearSeguimientoPendiente("NOMBRE-PENDIENTE-SIGUE");
    await aislarLotePara(seguimientoId);
    vi.stubGlobal("fetch", vi.fn(async () => respuestaJson({}, 403)));

    await revisarSeguimientosDelDia();

    const [actualizado] = await dbComoEmpresa(empresaId, (tx) => tx.select().from(seguimientosMl).where(eq(seguimientosMl.id, seguimientoId)));
    expect(actualizado.nombre).toBe(NOMBRE_PENDIENTE_PRIMERA_REVISION);
  });
});

// Issue #204 — bug real en staging: una fila recién agregada se
// quedaba en guiones hasta que corría el cron (hasta una hora
// después, el workflow corre cada hora). revisarAhoraUnSeguimiento()
// opera sobre UN seguimiento puntual — nunca necesita aislarLotePara()
// como el resto de este archivo, porque nunca toca
// obtenerSeguimientosPendientesDeHoy() (cross-empresa); no hay ningún
// lote ajeno con el que pueda chocar.
describe("revisarAhoraUnSeguimiento (issue #204)", () => {
  async function crearSeguimientoConCuenta(prefijo: string) {
    const { empresaId, usuarioId } = await crearEmpresaConUsuario(prefijo);
    await dbComoEmpresa(empresaId, (tx) =>
      tx.insert(cuentasMl).values({
        empresaId,
        cuentaIdExterna: `${Date.now()}${Math.floor(Math.random() * 10_000)}`,
        nickname: `VENDEDOR_${prefijo}`,
        accessTokenCifrado: cifrarToken("access-vigente"),
        refreshTokenCifrado: cifrarToken("refresh"),
        tokenExpiraTs: new Date(Date.now() + 3600_000),
      })
    );
    const [seguimiento] = await dbComoEmpresa(empresaId, (tx) =>
      tx
        .insert(seguimientosMl)
        .values({
          empresaId,
          tipo: "producto",
          recursoMl: "item",
          mlIdExterno: nuevoMlId(),
          nombre: "Producto de prueba",
          linkOriginal: "https://x",
          creadoPor: usuarioId,
        })
        .returning()
    );
    return seguimiento;
  }

  afterEach(() => vi.unstubAllGlobals());

  it("crea la primera foto al instante (nunca espera al cron) y marca ultima_revision_ts; sin alertas, nada con qué comparar todavía", async () => {
    const seguimiento = await crearSeguimientoConCuenta("PRIMERA-FOTO");
    vi.stubGlobal("fetch", vi.fn(async () => respuestaJson({ price: 100, sold_quantity: 10, status: "active" })));

    const resultado = await revisarAhoraUnSeguimiento(seguimiento);

    expect(resultado).toEqual({ ok: true, saltado: false, alertasCreadas: 0 });

    const hoy = new Date();
    hoy.setUTCHours(0, 0, 0, 0);
    const [fotoHoy] = await dbComoEmpresa(seguimiento.empresaId, (tx) =>
      tx.select().from(seguimientoFotos).where(and(eq(seguimientoFotos.seguimientoId, seguimiento.id), eq(seguimientoFotos.fecha, hoy)))
    );
    expect(fotoHoy).toBeDefined();
    expect(Number(fotoHoy.precio)).toBe(100);
    expect(fotoHoy.vendidos).toBe(10);

    const [actualizado] = await dbComoEmpresa(seguimiento.empresaId, (tx) => tx.select().from(seguimientosMl).where(eq(seguimientosMl.id, seguimiento.id)));
    expect(actualizado.ultimaRevisionTs).not.toBeNull();
  });

  it("si ya hay una foto de hoy (ej. el cron ya corrió), queda saltado — nunca duplica ni sobreescribe", async () => {
    const seguimiento = await crearSeguimientoConCuenta("YA-REVISADO-HOY");
    const hoy = new Date();
    hoy.setUTCHours(0, 0, 0, 0);
    await dbComoEmpresa(seguimiento.empresaId, (tx) =>
      tx.insert(seguimientoFotos).values({ empresaId: seguimiento.empresaId, seguimientoId: seguimiento.id, fecha: hoy, precio: "50", estado: "active" })
    );
    vi.stubGlobal("fetch", vi.fn(async () => respuestaJson({ price: 999, status: "active" }))); // si duplicara, este precio lo delataría

    const resultado = await revisarAhoraUnSeguimiento(seguimiento);

    expect(resultado).toEqual({ ok: true, saltado: true, alertasCreadas: 0 });

    const fotosDeHoy = await dbComoEmpresa(seguimiento.empresaId, (tx) =>
      tx.select().from(seguimientoFotos).where(and(eq(seguimientoFotos.seguimientoId, seguimiento.id), eq(seguimientoFotos.fecha, hoy)))
    );
    expect(fotosDeHoy).toHaveLength(1);
    expect(Number(fotosDeHoy[0].precio)).toBe(50); // la que ya estaba, nunca 999
  });

  it("empresa sin cuenta ML conectada: {ok:false,error} claro, y NUNCA marca ultima_revision_ts (para que el cron de hoy mismo lo reintente)", async () => {
    const { empresaId, usuarioId } = await crearEmpresaConUsuario("SIN-CUENTA-INMEDIATA");
    const [seguimiento] = await dbComoEmpresa(empresaId, (tx) =>
      tx
        .insert(seguimientosMl)
        .values({
          empresaId,
          tipo: "producto",
          recursoMl: "item",
          mlIdExterno: nuevoMlId(),
          nombre: "Sin cuenta ML",
          linkOriginal: "https://x",
          creadoPor: usuarioId,
        })
        .returning()
    );

    const resultado = await revisarAhoraUnSeguimiento(seguimiento);

    expect(resultado.ok).toBe(false);
    expect((resultado as { ok: false; error: string }).error).toMatch(/ninguna cuenta de Mercado Libre/);

    const [sinTocar] = await dbComoEmpresa(empresaId, (tx) => tx.select().from(seguimientosMl).where(eq(seguimientosMl.id, seguimiento.id)));
    expect(sinTocar.ultimaRevisionTs).toBeNull();
  });
});

// Issue #175, punto 2 — "hoy toma siempre los mismos 50 sin orden, así
// que el seguimiento 51 nunca se revisa": estas pruebas confirman el
// orden (ASC NULLS FIRST por ultima_revision_ts) y el filtro (nunca
// eliminado, nunca uno ya revisado hoy) contra Postgres real, sin
// pasar por toda la cadena de leer/comparar/alertar.
describe("obtenerSeguimientosPendientesDeHoy — orden y filtro del lote (issue #175)", () => {
  it("nunca trae un seguimiento ya eliminado", async () => {
    const { empresaId, usuarioId } = await crearEmpresaConUsuario("LOTE-ELIM");
    const [eliminado] = await dbComoEmpresa(empresaId, (tx) =>
      tx
        .insert(seguimientosMl)
        .values({
          empresaId,
          tipo: "producto",
          recursoMl: "item",
          mlIdExterno: nuevoMlId(),
          nombre: "Eliminado",
          linkOriginal: "https://x",
          creadoPor: usuarioId,
          eliminadoTs: new Date(),
        })
        .returning({ id: seguimientosMl.id })
    );

    const pendientes = await obtenerSeguimientosPendientesDeHoy();
    expect(pendientes.some((p) => p.id === eliminado.id)).toBe(false);
  });

  it("excluye el revisado hace menos de 6 horas, incluye los de hace más de 6h/1 día/nunca, y ordena ASC NULLS FIRST", async () => {
    const { empresaId, usuarioId } = await crearEmpresaConUsuario("LOTE-ORDEN");
    const base = { empresaId, tipo: "producto" as const, recursoMl: "item" as const, linkOriginal: "https://x", creadoPor: usuarioId };

    const unDiaAtras = new Date();
    unDiaAtras.setUTCDate(unDiaAtras.getUTCDate() - 1);
    const hace8Horas = new Date();
    hace8Horas.setUTCHours(hace8Horas.getUTCHours() - 8);
    const hace3Horas = new Date();
    hace3Horas.setUTCHours(hace3Horas.getUTCHours() - 3);

    const [nuncaRevisado] = await dbComoEmpresa(empresaId, (tx) => tx.insert(seguimientosMl).values({ ...base, mlIdExterno: nuevoMlId(), nombre: "Nunca" }).returning());
    const [revisadoAyer] = await dbComoEmpresa(empresaId, (tx) =>
      tx.insert(seguimientosMl).values({ ...base, mlIdExterno: nuevoMlId(), nombre: "Hace 1 día", ultimaRevisionTs: unDiaAtras }).returning()
    );
    // Issue #250, punto E — regresión directa: "hace 8 horas" puede
    // ser el MISMO día calendario que "ahora" (ej. revisado a la 1am,
    // ahora son las 9am) — antes del fix, el filtro por fecha
    // calendario lo hubiera excluido igual que el de "hoy", nunca
    // llegaba a la segunda ventana de la tarde.
    const [revisadoHace8Horas] = await dbComoEmpresa(empresaId, (tx) =>
      tx.insert(seguimientosMl).values({ ...base, mlIdExterno: nuevoMlId(), nombre: "Hace 8 horas", ultimaRevisionTs: hace8Horas }).returning()
    );
    // "Hace 3 horas" siempre dentro de la ventana mínima de 6 horas —
    // tiene que seguir excluido, sea el mismo día calendario o no.
    const [revisadoHace3Horas] = await dbComoEmpresa(empresaId, (tx) =>
      tx.insert(seguimientosMl).values({ ...base, mlIdExterno: nuevoMlId(), nombre: "Hace 3 horas", ultimaRevisionTs: hace3Horas }).returning()
    );

    const pendientes = await obtenerSeguimientosPendientesDeHoy();
    const idsDeEstaEmpresa = pendientes.filter((p) => p.empresaId === empresaId).map((p) => p.id);

    // El de "hace 3 horas" nunca aparece (dentro de la ventana mínima
    // de 6h); el resto, del que hace más tiempo que no se revisa (o
    // nunca) al más reciente.
    expect(idsDeEstaEmpresa).toEqual([nuncaRevisado.id, revisadoAyer.id, revisadoHace8Horas.id]);
    expect(idsDeEstaEmpresa).not.toContain(revisadoHace3Horas.id);
  });
});
