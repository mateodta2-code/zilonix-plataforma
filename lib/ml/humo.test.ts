import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { dbComoEmpresa } from "@/db/empresa-context";
import { cuentasMl, despachosMl } from "@/db/schema";
import { crearDosEmpresas } from "@/db/test-utils/aislamiento";
import { crearCuentaMlDePrueba, crearPedidoDePrueba } from "@/db/test-utils/venta";
import { cifrarToken } from "@/lib/cifrado";
import { guardarCuentaConectada } from "./cuentas";
import { sincronizarDespacho } from "./despachos";
import { intercambiarCodigo, obtenerDatosVendedorMl } from "./oauth";
import { listarPedidosFiltrados } from "./pedidos";

// Issue #320 — 3 humos automáticos en el mismo job de CI que ya corre
// el Postgres efímero (build-and-test): conectar una cuenta de ML,
// listar pedidos y un despacho básico. Complementan, nunca reemplazan,
// el humo manual de producción (scripts/humo.sh, issue #45/#74): ese
// pega contra una URL real desplegada; estos corren en cada PR, contra
// código y Postgres real, pero CERO llamadas de red reales — toda
// "llamada a Mercado Libre" es el mismo fetch estubeado de siempre
// (mismo patrón que lib/ml/oauth.test.ts y lib/ml/despachos.test.ts).
const BASE_ML = "https://api.mercadolibre.com";

// Nunca una URL que no sea de Mercado Libre: si algún día un cambio
// hiciera que una de estas 3 funciones llamara a otro lado (por
// ejemplo, un fetch suelto que no pase por lib/ml/cliente.ts u
// oauth.ts), este mock revienta ahí mismo en vez de devolver cualquier
// cosa en silencio.
function fetchSeguroMl(resolver: (url: string) => unknown) {
  return vi.fn(async (entrada: string | URL) => {
    const url = typeof entrada === "string" ? entrada : entrada.toString();
    if (!url.startsWith(BASE_ML)) {
      throw new Error(`humo: el fetch estubeado iba a llamar a una URL que NO es de Mercado Libre: ${url}`);
    }
    const data = resolver(url);
    return { ok: true, status: 200, json: async () => data, text: async () => JSON.stringify(data) } as Response;
  });
}

// Issue #320 ("sin secretos reales en los logs") — espía los 3 canales
// que el código de verdad usa (console.warn en lib/ml/cliente.ts y
// lib/ml/cuentas.ts; log/error por si algo cambia) y silencia la
// salida para no ensuciar el log de CI. tokensFalsos son marcadores
// propios de cada humo (nunca el texto genérico "access-de-prueba" que
// comparten otros tests) para que la comprobación sea inequívoca.
let logSpy: ReturnType<typeof vi.spyOn>;
let warnSpy: ReturnType<typeof vi.spyOn>;
let errorSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  process.env.ML_CLIENT_ID = "ml-client-id-humo";
  process.env.ML_CLIENT_SECRET = "ml-client-secret-humo";
  logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
  warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
  errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function assertSinSecretosEnConsola(...tokensFalsos: string[]) {
  const llamadas = [...logSpy.mock.calls, ...warnSpy.mock.calls, ...errorSpy.mock.calls];
  const texto = llamadas.map((args) => args.map((a) => (typeof a === "string" ? a : JSON.stringify(a))).join(" ")).join("\n");
  for (const token of tokensFalsos) {
    expect(texto, `un token falso (${token}) no debería aparecer en ningún console.log/warn/error`).not.toContain(token);
  }
}

describe("humos de CI (issue #320)", () => {
  it("humo: conectar ML — intercambia el code (mock) y guarda la cuenta en Postgres real", async () => {
    const TOKEN_FALSO_ACCESS = "humo-secreto-access-nunca-en-logs";
    const TOKEN_FALSO_REFRESH = "humo-secreto-refresh-nunca-en-logs";

    // user_id aleatorio (mismo criterio que db/rls-cuentas-ml.test.ts
    // y lib/ml/despachos.test.ts para cuentaIdExterna): si este humo
    // se corriera dos veces contra el mismo Postgres (nunca pasa en el
    // efímero de CI, pero sí podría en una base local persistente), un
    // id fijo chocaría con la cuenta que dejó la corrida anterior.
    const userIdMl = Date.now() + Math.floor(Math.random() * 10_000);
    const fetchMock = fetchSeguroMl((url) => {
      if (url.endsWith("/oauth/token")) {
        return { access_token: TOKEN_FALSO_ACCESS, refresh_token: TOKEN_FALSO_REFRESH, expires_in: 21_600, user_id: userIdMl };
      }
      if (url.endsWith("/users/me")) {
        return { nickname: "VENDEDOR_HUMO", site_id: "MCO" };
      }
      throw new Error(`humo: endpoint de ML inesperado en "conectar ML": ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    const contexto = await crearDosEmpresas();
    const tokens = await intercambiarCodigo("code-de-prueba", "https://humo.zilonix.test/api/ml/callback", "verifier-de-prueba");
    const datosVendedor = await obtenerDatosVendedorMl(tokens.accessToken);

    const cuenta = await guardarCuentaConectada(contexto.empresaAId, {
      cuentaIdExterna: tokens.cuentaIdExterna,
      nickname: datosVendedor.nickname,
      tokens,
      siteId: datosVendedor.siteId,
    });

    const [fila] = await dbComoEmpresa(contexto.empresaAId, (tx) => tx.select().from(cuentasMl).where(eq(cuentasMl.id, cuenta.id)));
    expect(fila.nickname).toBe("VENDEDOR_HUMO");
    expect(fila.desconectadaTs).toBeNull();

    expect(fetchMock.mock.calls.length).toBeGreaterThan(0);
    expect(fetchMock.mock.calls.every(([url]) => String(url).startsWith(BASE_ML))).toBe(true);
    assertSinSecretosEnConsola(TOKEN_FALSO_ACCESS, TOKEN_FALSO_REFRESH);
  });

  it("humo: listar pedidos — lee de Postgres real, nunca llama a Mercado Libre", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const contexto = await crearDosEmpresas();
    const cuentaMlId = await crearCuentaMlDePrueba(contexto.empresaAId);
    const pedidoId = await crearPedidoDePrueba(contexto.empresaAId, cuentaMlId);

    const resultado = await listarPedidosFiltrados(contexto.empresaAId);

    expect(resultado.pedidos.map((p) => p.id)).toContain(pedidoId);
    expect(fetchMock).not.toHaveBeenCalled();
    assertSinSecretosEnConsola();
  });

  it("humo: despacho básico — sincroniza un envío (mock) y queda en despachos_ml de Postgres real", async () => {
    const TOKEN_FALSO_ACCESS = "humo-secreto-despacho-nunca-en-logs";

    const fetchMock = fetchSeguroMl((url) => {
      if (url.includes("/sla")) return { status: "on_time", expected_date: "2026-03-15T20:00:00Z" };
      if (url.includes("/shipments/")) return { status: "ready_to_ship", substatus: null, logistic_type: "self_service" };
      throw new Error(`humo: endpoint de ML inesperado en "despacho básico": ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    const contexto = await crearDosEmpresas();
    // Cuenta propia (no crearCuentaMlDePrueba) para controlar el access
    // token guardado: es justo lo que obtenerAccessTokenVigente
    // descifra y manda en el header Authorization al llamar a ML — el
    // marcador deja comprobar que ESE valor nunca termina en consola.
    const [cuenta] = await dbComoEmpresa(contexto.empresaAId, (tx) =>
      tx
        .insert(cuentasMl)
        .values({
          empresaId: contexto.empresaAId,
          cuentaIdExterna: `ml-user-humo-despacho-${contexto.empresaAId.slice(0, 8)}`,
          nickname: "VENDEDOR_HUMO_DESPACHO",
          accessTokenCifrado: cifrarToken(TOKEN_FALSO_ACCESS),
          refreshTokenCifrado: cifrarToken("humo-secreto-refresh-despacho-nunca-en-logs"),
          tokenExpiraTs: new Date(Date.now() + 3_600_000),
        })
        .returning({ id: cuentasMl.id })
    );
    const pedidoId = await crearPedidoDePrueba(contexto.empresaAId, cuenta.id);

    await sincronizarDespacho(contexto.empresaAId, cuenta.id, pedidoId, "778899");

    const [despacho] = await dbComoEmpresa(contexto.empresaAId, (tx) =>
      tx.select().from(despachosMl).where(eq(despachosMl.pedidoId, pedidoId))
    );
    expect(despacho.status).toBe("ready_to_ship");
    expect(despacho.shipmentIdExterno).toBe("778899");

    expect(fetchMock.mock.calls.length).toBeGreaterThan(0);
    expect(fetchMock.mock.calls.every(([url]) => String(url).startsWith(BASE_ML))).toBe(true);
    assertSinSecretosEnConsola(TOKEN_FALSO_ACCESS);
  });
});
