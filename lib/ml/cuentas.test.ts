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

async function crearCuenta(empresaId: string, datos: Partial<{ desconectadaTs: Date | null; tokenExpiraTs: Date; renovandoTs: Date | null }> = {}) {
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
        renovandoTs: datos.renovandoTs ?? null,
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
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

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
    // ML_CLIENT_ID/ML_CLIENT_SECRET real (nunca vacíos en CI) para que la
    // llamada llegue de verdad a fetch y pase por el invalid_grant real de
    // oauth.ts — sin esto, a renovarToken() le faltaría la variable de
    // entorno y fallaría ANTES de llamar a fetch, dando el mismo
    // RenovacionTokenFallidaError pero por la razón equivocada.
    vi.stubEnv("ML_CLIENT_ID", "client-id-de-prueba");
    vi.stubEnv("ML_CLIENT_SECRET", "client-secret-de-prueba");
    const empresaId = await crearEmpresa("RENOVACION-FALLA");
    const cuentaId = await crearCuenta(empresaId, { tokenExpiraTs: new Date(Date.now() - 1000) }); // ya vencido
    const fetchMock = vi.fn(async () => ({ ok: false, status: 400, text: async () => '{"error":"invalid_grant"}' }) as Response);
    vi.stubGlobal("fetch", fetchMock);
    await expect(obtenerAccessTokenVigente(empresaId, cuentaId)).rejects.toThrow(RenovacionTokenFallidaError);
    expect(fetchMock).toHaveBeenCalled();
  });

  // No se prueba la concurrencia real (dos llamadas en paralelo): en CI
  // falta ML_CLIENT_SECRET, así que la primera llamada falla (y libera el
  // candado) en vez de quedarse "en curso", y además el UPDATE que toma el
  // candado vive en la transacción NO CONFIRMADA de la primera llamada —
  // una segunda transacción (dbComoEmpresa abre una por llamada) no puede
  // ver esa fila tomada hasta que la primera haga commit. Se prueba en
  // cambio el resultado que ese candado tiene que producir: una cuenta que
  // YA tiene el candado tomado (renovandoTs reciente, <30s) rechaza la
  // renovación sin llegar a tocar la red.
  it("candado: si ya hay una renovación en curso (renovandoTs reciente), se niega sin llamar a Mercado Libre", async () => {
    const empresaId = await crearEmpresa("CANDADO");
    const cuentaId = await crearCuenta(empresaId, {
      tokenExpiraTs: new Date(Date.now() - 1000), // vencido, entraría a renovar si no fuera por el candado
      renovandoTs: new Date(), // candado tomado hace instantes — bien por debajo de los 30s de "caído"
    });
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    await expect(obtenerAccessTokenVigente(empresaId, cuentaId)).rejects.toThrow(CandadoDeRenovacionError);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
