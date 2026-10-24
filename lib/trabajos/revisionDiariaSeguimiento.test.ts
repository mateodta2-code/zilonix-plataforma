import { randomUUID } from "crypto";
import { and, eq, isNull, lt, ne, or } from "drizzle-orm";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { dbComoEmpresa } from "@/db/empresa-context";
import { db } from "@/db/index";
import { dbTrabajadorSeguimiento } from "@/db/trabajador-seguimiento-context";
import { cuentasMl, empresas, seguimientoAlertas, seguimientoFotos, seguimientosMl, usuarios } from "@/db/schema";
import { cifrarToken } from "@/lib/cifrado";
import { obtenerSeguimientosPendientesDeHoy, revisarSeguimientosDelDia } from "./revisionDiariaSeguimiento";

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

function nuevoMlId() {
  return `MCO${randomUUID().replace(/-/g, "").slice(0, 10)}`;
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

    expect(resultado.fallidos).toBe(0);
    expect(resultado.procesados).toBeGreaterThanOrEqual(1);

    const hoy = new Date();
    hoy.setUTCHours(0, 0, 0, 0);
    const [fotoHoy] = await dbComoEmpresa(empresaId, (tx) =>
      tx.select().from(seguimientoFotos).where(and(eq(seguimientoFotos.seguimientoId, seguimientoId), eq(seguimientoFotos.fecha, hoy)))
    );
    expect(fotoHoy).toBeDefined();
    expect(fotoHoy.vendidos).toBe(15);

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
  it("corrida repetida el mismo día: el seguimiento ya no entra al lote, nunca duplica la foto", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => respuestaJson({ price: 999, status: "active" }))); // si duplicara, este precio lo delataría

    await revisarSeguimientosDelDia();

    const hoy = new Date();
    hoy.setUTCHours(0, 0, 0, 0);
    const fotosDeHoy = await dbComoEmpresa(empresaId, (tx) =>
      tx.select().from(seguimientoFotos).where(and(eq(seguimientoFotos.seguimientoId, seguimientoId), eq(seguimientoFotos.fecha, hoy)))
    );
    expect(fotosDeHoy).toHaveLength(1);
    expect(Number(fotosDeHoy[0].precio)).toBe(80); // la de la corrida anterior, nunca 999
  });
});

// Issue real, encontrado en CI (segunda vuelta del fix de orden/filtro):
// si un seguimiento fallido (ej. empresa sin cuenta ML conectada) NUNCA
// marca ultima_revision_ts, el orden ASC NULLS FIRST lo deja al frente
// del lote para siempre — ahoga los 50 cupos en cada corrida siguiente
// (en CI, con varios seguimientos viejos sin cuenta, esto hacía
// timeout: cada uno paga PAUSA_ENTRE_SEGUIMIENTOS_MS). La corrección
// real está en revisionDiariaSeguimiento.ts: también marca
// ultima_revision_ts en el catch.
describe("revisarSeguimientosDelDia — un fallido no ahoga el lote para siempre (issue #175)", () => {
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

  it("cuenta como fallido Y queda con ultima_revision_ts no null, y no vuelve a aparecer en el lote de hoy", async () => {
    const resultado = await revisarSeguimientosDelDia();

    expect(resultado.fallidos).toBe(1);

    const [actualizado] = await dbComoEmpresa(empresaId, (tx) => tx.select().from(seguimientosMl).where(eq(seguimientosMl.id, seguimientoId)));
    expect(actualizado.ultimaRevisionTs).not.toBeNull();

    const pendientes = await obtenerSeguimientosPendientesDeHoy();
    expect(pendientes.some((p) => p.id === seguimientoId)).toBe(false);
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

  it("excluye el ya revisado HOY, incluye los de ayer/hace 2 días/nunca, y ordena ASC NULLS FIRST", async () => {
    const { empresaId, usuarioId } = await crearEmpresaConUsuario("LOTE-ORDEN");
    const base = { empresaId, tipo: "producto" as const, recursoMl: "item" as const, linkOriginal: "https://x", creadoPor: usuarioId };

    const dosDiasAtras = new Date();
    dosDiasAtras.setUTCHours(0, 0, 0, 0);
    dosDiasAtras.setUTCDate(dosDiasAtras.getUTCDate() - 2);
    const unDiaAtras = new Date();
    unDiaAtras.setUTCHours(0, 0, 0, 0);
    unDiaAtras.setUTCDate(unDiaAtras.getUTCDate() - 1);

    const [nuncaRevisado] = await dbComoEmpresa(empresaId, (tx) => tx.insert(seguimientosMl).values({ ...base, mlIdExterno: nuevoMlId(), nombre: "Nunca" }).returning());
    const [revisadoHaceDosDias] = await dbComoEmpresa(empresaId, (tx) =>
      tx.insert(seguimientosMl).values({ ...base, mlIdExterno: nuevoMlId(), nombre: "Hace 2 días", ultimaRevisionTs: dosDiasAtras }).returning()
    );
    const [revisadoAyer] = await dbComoEmpresa(empresaId, (tx) =>
      tx.insert(seguimientosMl).values({ ...base, mlIdExterno: nuevoMlId(), nombre: "Ayer", ultimaRevisionTs: unDiaAtras }).returning()
    );
    const [revisadoHoy] = await dbComoEmpresa(empresaId, (tx) =>
      tx.insert(seguimientosMl).values({ ...base, mlIdExterno: nuevoMlId(), nombre: "Hoy", ultimaRevisionTs: new Date() }).returning()
    );

    const pendientes = await obtenerSeguimientosPendientesDeHoy();
    const idsDeEstaEmpresa = pendientes.filter((p) => p.empresaId === empresaId).map((p) => p.id);

    // El de "hoy" nunca aparece; el resto, del que hace más tiempo que
    // no se revisa (o nunca) al más reciente.
    expect(idsDeEstaEmpresa).toEqual([nuncaRevisado.id, revisadoHaceDosDias.id, revisadoAyer.id]);
    expect(idsDeEstaEmpresa).not.toContain(revisadoHoy.id);
  });
});
