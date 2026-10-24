import { randomUUID } from "crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { dbComoEmpresa } from "@/db/empresa-context";
import { cuentasMl, empresas } from "@/db/schema";
import { cifrarToken } from "@/lib/cifrado";
import { CandadoDeRenovacionError, CuentaDesconectadaError, CuentaMlNoEncontradaError, obtenerAccessTokenVigente, RenovacionTokenFallidaError } from "./cuentas";

async function crearEmpresa(prefijo: string) {
  const empresaId = randomUUID();
  await dbComoEmpresa(empresaId, (tx) => tx.insert(empresas).values({ id: empresaId, nombre: `Empresa ${prefijo}`, nit: `TEST-${prefijo}-${empresaId.slice(0, 8)}` }));
  return empresaId;
}

async function crearCuenta(empresaId: string, datos: Partial<{ desconectadaTs: Date | null; tokenExpiraTs: Date }> = {}) {
  const [cuenta] = await dbComoEmpresa(empresaId, (tx) =>
    tx
      .insert(cuentasMl)
      .values({
        empresaId,
        cuentaIdExterna: `ml-user-${randomUUID().slice(0, 8)}`,
        nickname: "VENDEDOR",
        accessTokenCifrado: cifrarToken("access"),
        refreshTokenCifrado: cifrarToken("refresh"),
        tokenExpiraTs: datos.tokenExpiraTs ?? new Date(Date.now() + 3600_000),
        desconectadaTs: datos.desconectadaTs ?? null,
      })
      .returning({ id: cuentasMl.id })
  );
  return cuenta.id;
}

// Issue #147, punto 2 — cuentas.ts L51/L52/L66/L86 lanzaban Error
// genéricos que ninguna página atrapaba. Cuatro formas de fallar,
// cuatro clases distintas, para que una página las pueda distinguir
// sin adivinar por el texto del mensaje.
describe("obtenerAccessTokenVigente — errores tipados (issue #147)", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("cuenta inexistente: CuentaMlNoEncontradaError", async () => {
    const empresaId = await crearEmpresa("CUENTA-NO-EXISTE");
    await expect(obtenerAccessTokenVigente(empresaId, randomUUID())).rejects.toThrow(CuentaMlNoEncontradaError);
  });

  it("cuenta desconectada: CuentaDesconectadaError", async () => {
    const empresaId = await crearEmpresa("DESCONECTADA");
    const cuentaId = await crearCuenta(empresaId, { desconectadaTs: new Date() });
    await expect(obtenerAccessTokenVigente(empresaId, cuentaId)).rejects.toThrow(CuentaDesconectadaError);
  });

  it("token todavía vigente: no renueva nada, no lanza", async () => {
    const empresaId = await crearEmpresa("VIGENTE");
    const cuentaId = await crearCuenta(empresaId, { tokenExpiraTs: new Date(Date.now() + 3600_000) });
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    await expect(obtenerAccessTokenVigente(empresaId, cuentaId)).resolves.toBe("access");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("token vencido y Mercado Libre rechaza la renovación (invalid_grant real): RenovacionTokenFallidaError, nunca el Error crudo de oauth.ts", async () => {
    const empresaId = await crearEmpresa("RENOVACION-FALLA");
    const cuentaId = await crearCuenta(empresaId, { tokenExpiraTs: new Date(Date.now() - 1000) }); // ya vencido
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: false, status: 400, text: async () => '{"error":"invalid_grant"}' }) as Response)
    );
    await expect(obtenerAccessTokenVigente(empresaId, cuentaId)).rejects.toThrow(RenovacionTokenFallidaError);
  });

  it("candado: una segunda renovación concurrente de la MISMA cuenta se niega en vez de pisar la primera", async () => {
    const empresaId = await crearEmpresa("CANDADO");
    const cuentaId = await crearCuenta(empresaId, { tokenExpiraTs: new Date(Date.now() - 1000) });
    // Primera renovación: fetch que nunca resuelve (simula "en curso") — se
    // dispara sin esperar, para que el candado quede tomado cuando la
    // segunda llamada intente tomarlo también.
    vi.stubGlobal("fetch", vi.fn(() => new Promise(() => {})));
    const primera = obtenerAccessTokenVigente(empresaId, cuentaId).catch(() => null);
    await new Promise((r) => setTimeout(r, 50)); // deja que la primera alcance a tomar el candado
    await expect(obtenerAccessTokenVigente(empresaId, cuentaId)).rejects.toThrow(CandadoDeRenovacionError);
    await primera; // no deja la promesa colgada entre pruebas
  });
});
