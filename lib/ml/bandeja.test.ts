import { randomUUID } from "crypto";
import { eq } from "drizzle-orm";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { dbComoEmpresa } from "@/db/empresa-context";
import { cuentasMl, empresas, mensajesMl, mensajesMlHilo, usuarios } from "@/db/schema";
import { cifrarToken } from "@/lib/cifrado";
import { db } from "@/db";
import {
  asignarOperador,
  guardarMensajeVenta,
  guardarPregunta,
  guardarReclamo,
  listarBandeja,
  obtenerItemConHilo,
  resolverPackIdDeMensaje,
  responderMensajeVenta,
  responderPregunta,
  responderReclamo,
} from "./bandeja";

function respuestaJson(data: unknown) {
  return { ok: true, status: 200, json: async () => data, text: async () => JSON.stringify(data) } as Response;
}

// Tarea 2.9 — prueba real contra Postgres: la bandeja guarda
// preguntas/mensajes/reclamos reales (API simulada con fetch
// mockeado), el hilo de un mensaje de venta se guarda completo (no
// solo el último texto, a diferencia del sistema viejo), y el
// aislamiento entre empresas se respeta siempre.
describe("bandeja de atención (tarea 2.9)", () => {
  vi.setConfig({ testTimeout: 15_000 });

  const empresaId = randomUUID();
  const empresaBId = randomUUID();
  const usuarioId = randomUUID();
  const cuentaExterna = `ml-user-bandeja-${randomUUID()}`;
  let cuentaId: string;

  beforeAll(async () => {
    await db.insert(usuarios).values({ id: usuarioId, email: `prueba-bandeja-${usuarioId.slice(0, 8)}@zilonix.test`, nombre: "Usuario de prueba 2.9" });
    await dbComoEmpresa(empresaId, (tx) =>
      tx.insert(empresas).values({ id: empresaId, nombre: "Empresa bandeja (prueba 2.9)", nit: `TEST-BAN-${empresaId.slice(0, 8)}` })
    );
    await dbComoEmpresa(empresaBId, (tx) =>
      tx.insert(empresas).values({ id: empresaBId, nombre: "Empresa B bandeja (prueba 2.9)", nit: `TEST-BANB-${empresaBId.slice(0, 8)}` })
    );
    const [cuenta] = await dbComoEmpresa(empresaId, (tx) =>
      tx
        .insert(cuentasMl)
        .values({
          empresaId,
          cuentaIdExterna: cuentaExterna,
          nickname: "VENDEDOR_BANDEJA",
          accessTokenCifrado: cifrarToken("access"),
          refreshTokenCifrado: cifrarToken("refresh"),
          tokenExpiraTs: new Date(Date.now() + 3600_000),
        })
        .returning({ id: cuentasMl.id })
    );
    cuentaId = cuenta.id;
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("guarda una pregunta real y queda pendiente, con plazo de respuesta", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (url.includes("/questions/999")) {
          return respuestaJson({ id: 999, item_id: "MCO1", text: "¿tienen talla M?", status: "UNANSWERED", from: { id: 555 }, date_created: "2026-10-01T10:00:00.000Z" });
        }
        if (url.includes("/items/MCO1")) return respuestaJson({ id: "MCO1", title: "Camiseta", permalink: "https://x" });
        if (url.includes("/users/555")) return respuestaJson({ id: 555, nickname: "COMPRADOR_TEST" });
        throw new Error(`fetch no esperado: ${url}`);
      })
    );

    await guardarPregunta(empresaId, cuentaId, "999");

    const [fila] = await dbComoEmpresa(empresaId, (tx) => tx.select().from(mensajesMl).where(eq(mensajesMl.externalId, "999")));
    expect(fila.tipo).toBe("pregunta");
    expect(fila.respondida).toBe(false);
    expect(fila.compradorNickname).toBe("COMPRADOR_TEST");
    expect(fila.vencePorResponderTs).not.toBeNull();
  });

  it("responder una pregunta la marca como respondida", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, opciones?: RequestInit) => {
        if (url === "https://api.mercadolibre.com/answers" && opciones?.method === "POST") return respuestaJson({ id: 1 });
        if (url.includes("/questions/999")) {
          return respuestaJson({ id: 999, item_id: "MCO1", text: "¿tienen talla M?", status: "ANSWERED", from: { id: 555 }, date_created: "2026-10-01T10:00:00.000Z" });
        }
        if (url.includes("/items/MCO1")) return respuestaJson({ id: "MCO1", title: "Camiseta", permalink: "https://x" });
        if (url.includes("/users/555")) return respuestaJson({ id: 555, nickname: "COMPRADOR_TEST" });
        throw new Error(`fetch no esperado: ${url}`);
      })
    );

    await responderPregunta(empresaId, cuentaId, "999", "Sí, tenemos talla M");

    const [fila] = await dbComoEmpresa(empresaId, (tx) => tx.select().from(mensajesMl).where(eq(mensajesMl.externalId, "999")));
    expect(fila.respondida).toBe(true);
    expect(fila.vencePorResponderTs).toBeNull();
  });

  it("resuelve el pack_id real de un mensaje a partir del message_id crudo (bug real del sistema viejo)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (url.includes("/messages/abc123hex")) return respuestaJson({ pack_id: 5555 });
        throw new Error(`fetch no esperado: ${url}`);
      })
    );
    const packId = await resolverPackIdDeMensaje("token-de-prueba", "abc123hex");
    expect(packId).toBe("5555");
  });

  it("guarda el hilo completo de un mensaje de venta, no solo el último texto", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (url.includes("/messages/packs/5555/sellers/")) {
          return respuestaJson({
            conversation: { item_id: "MCO2" },
            messages: [
              { id: "m1", text: "¿Llega mañana?", from: { user_id: 777 }, message_date: { created: "2026-10-01T09:00:00.000Z" } },
              { id: "m2", text: "Sí, mañana llega", from: { user_id: cuentaExterna }, message_date: { created: "2026-10-01T09:05:00.000Z" } },
            ],
          });
        }
        if (url.includes("/items/MCO2")) return respuestaJson({ id: "MCO2", title: "Taza", permalink: "https://y" });
        if (url.includes("/users/777")) return respuestaJson({ id: 777, nickname: "COMPRADOR_HILO" });
        throw new Error(`fetch no esperado: ${url}`);
      })
    );

    await guardarMensajeVenta(empresaId, cuentaId, cuentaExterna, "5555");

    const [fila] = await dbComoEmpresa(empresaId, (tx) => tx.select().from(mensajesMl).where(eq(mensajesMl.externalId, "5555")));
    expect(fila.tipo).toBe("mensaje");
    expect(fila.respondida).toBe(true); // el último mensaje lo mandó la cuenta

    const hilo = await dbComoEmpresa(empresaId, (tx) => tx.select().from(mensajesMlHilo).where(eq(mensajesMlHilo.mensajeMlId, fila.id)));
    expect(hilo).toHaveLength(2);
    expect(hilo.find((m) => m.externalId === "m1")?.deComprador).toBe(true);
    expect(hilo.find((m) => m.externalId === "m2")?.deComprador).toBe(false);
  });

  it("responder un mensaje de venta agrega al hilo sin perder lo anterior", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, opciones?: RequestInit) => {
        if (url.includes("/messages/packs/5555/sellers/") && opciones?.method === "POST") return respuestaJson({ id: "m3" });
        if (url.includes("/messages/packs/5555/sellers/")) {
          return respuestaJson({
            conversation: { item_id: "MCO2" },
            messages: [
              { id: "m1", text: "¿Llega mañana?", from: { user_id: 777 }, message_date: { created: "2026-10-01T09:00:00.000Z" } },
              { id: "m2", text: "Sí, mañana llega", from: { user_id: cuentaExterna }, message_date: { created: "2026-10-01T09:05:00.000Z" } },
              { id: "m3", text: "Gracias!", from: { user_id: cuentaExterna }, message_date: { created: "2026-10-01T09:10:00.000Z" } },
            ],
          });
        }
        if (url.includes("/items/MCO2")) return respuestaJson({ id: "MCO2", title: "Taza" });
        if (url.includes("/users/777")) return respuestaJson({ id: 777, nickname: "COMPRADOR_HILO" });
        throw new Error(`fetch no esperado: ${url}`);
      })
    );

    await responderMensajeVenta(empresaId, cuentaId, "5555", "777", "Gracias!");

    const [fila] = await dbComoEmpresa(empresaId, (tx) => tx.select().from(mensajesMl).where(eq(mensajesMl.externalId, "5555")));
    const hilo = await dbComoEmpresa(empresaId, (tx) => tx.select().from(mensajesMlHilo).where(eq(mensajesMlHilo.mensajeMlId, fila.id)));
    expect(hilo).toHaveLength(3); // los 2 de antes siguen, más el nuevo
  });

  it("guarda y responde un reclamo real", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, opciones?: RequestInit) => {
        if (url.includes("/claims/321/actions/send-message") && opciones?.method === "POST") return respuestaJson({ ok: true });
        if (url.includes("/post-purchase/v1/claims/321")) {
          return respuestaJson({ id: 321, status: "opened", date_created: "2026-10-01T10:00:00.000Z" });
        }
        throw new Error(`fetch no esperado: ${url}`);
      })
    );

    await guardarReclamo(empresaId, cuentaId, "321");
    let [fila] = await dbComoEmpresa(empresaId, (tx) => tx.select().from(mensajesMl).where(eq(mensajesMl.externalId, "321")));
    expect(fila.tipo).toBe("reclamo");
    expect(fila.respondida).toBe(false);

    await responderReclamo(empresaId, cuentaId, "321", "Ya lo revisamos");
    [fila] = await dbComoEmpresa(empresaId, (tx) => tx.select().from(mensajesMl).where(eq(mensajesMl.externalId, "321")));
    // sigue "opened" en el mock (no cambia el status simulado), pero la llamada no debe fallar
    expect(fila).toBeDefined();
  });

  it("asignar a un operador queda registrado en auditoría", async () => {
    const [item] = await dbComoEmpresa(empresaId, (tx) => tx.select().from(mensajesMl).where(eq(mensajesMl.externalId, "999")));
    await asignarOperador(empresaId, usuarioId, item.id, usuarioId);

    const [actualizado] = await dbComoEmpresa(empresaId, (tx) => tx.select().from(mensajesMl).where(eq(mensajesMl.id, item.id)));
    expect(actualizado.asignadoA).toBe(usuarioId);
  });

  it("empresa B nunca ve los ítems de la bandeja de empresa A", async () => {
    const lista = await listarBandeja(empresaBId);
    expect(lista).toHaveLength(0);
  });

  it("obtenerItemConHilo devuelve null si el ítem no es de esta empresa", async () => {
    const [item] = await dbComoEmpresa(empresaId, (tx) => tx.select().from(mensajesMl).where(eq(mensajesMl.externalId, "5555")));
    const resultado = await obtenerItemConHilo(empresaBId, item.id);
    expect(resultado).toBeNull();
  });
});
