import { randomUUID } from "crypto";
import { eq } from "drizzle-orm";
import { afterEach, describe, expect, it, vi } from "vitest";
import { dbComoEmpresa } from "@/db/empresa-context";
import { cuentasMl, empresas } from "@/db/schema";
import { cifrarToken, descifrarToken } from "@/lib/cifrado";
import type { TokensMl } from "@/lib/ml/oauth";
import {
  CandadoDeRenovacionError,
  CuentaDesconectadaError,
  CuentaMlDeOtraEmpresaError,
  CuentaMlNoEncontradaError,
  desconectarCuenta,
  guardarCuentaConectada,
  obtenerAccessTokenVigente,
  RenovacionTokenFallidaError,
} from "./cuentas";

async function crearEmpresa(prefijo: string) {
  const empresaId = randomUUID();
  await dbComoEmpresa(empresaId, (tx) => tx.insert(empresas).values({ id: empresaId, nombre: `Empresa ${prefijo}`, nit: `TEST-${prefijo}-${empresaId.slice(0, 8)}` }));
  return empresaId;
}

// Mismo helper numérico que clip.test.ts/publicar.test.ts/estado-item.test.ts
// (cuenta_id_externa real de Mercado Libre es solo dígitos).
function cuentaIdExternaDePrueba(): string {
  return `${Date.now()}${Math.floor(Math.random() * 10_000)}`;
}

function tokensDePrueba(cuentaIdExterna: string, sufijo: string): TokensMl {
  return { accessToken: `access-${sufijo}`, refreshToken: `refresh-${sufijo}`, expiraEnSegundos: 21_600, cuentaIdExterna };
}

async function crearCuenta(
  empresaId: string,
  datos: Partial<{ cuentaIdExterna: string; nickname: string; desconectadaTs: Date | null; tokenExpiraTs: Date; renovandoTs: Date | null }> = {}
) {
  const [cuenta] = await dbComoEmpresa(empresaId, (tx) =>
    tx
      .insert(cuentasMl)
      .values({
        empresaId,
        cuentaIdExterna: datos.cuentaIdExterna ?? `ml-user-${randomUUID().slice(0, 8)}`,
        nickname: datos.nickname ?? "VENDEDOR",
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

// Bug real en vivo en staging: reconectar una cuenta de Mercado Libre
// reventaba con "duplicate key value violates unique constraint
// cuentas_ml_cuenta_externa_unica" — guardarCuentaConectada hacía un
// INSERT simple y desconectarCuenta solo marca desconectadaTs (nunca
// borra la fila, para no perder el histórico importado), así que la
// misma cuenta de ML nunca se podía volver a conectar.
describe("guardarCuentaConectada — reconectar con INSERT ... ON CONFLICT DO UPDATE", () => {
  it("cuenta nunca vista: inserta una fila nueva", async () => {
    const empresaId = await crearEmpresa("GUARDAR-NUEVA");
    const cuentaIdExterna = cuentaIdExternaDePrueba();

    const resultado = await guardarCuentaConectada(empresaId, {
      cuentaIdExterna,
      nickname: "VENDEDOR_NUEVO",
      tokens: tokensDePrueba(cuentaIdExterna, "nueva"),
      siteId: null,
    });

    const [fila] = await dbComoEmpresa(empresaId, (tx) => tx.select().from(cuentasMl).where(eq(cuentasMl.id, resultado.id)));
    expect(fila.cuentaIdExterna).toBe(cuentaIdExterna);
    expect(fila.empresaId).toBe(empresaId);
    expect(fila.desconectadaTs).toBeNull();
  });

  // Issue #315 (Z-LATAM-01) — una cuenta nueva guarda el site_id real
  // que trae Mercado Libre, y deriva moneda/idioma de ahí (lib/ml/sitios.ts),
  // nunca el default a ciegas cuando sí hay un dato real.
  it("cuenta nueva con site_id real (ej. MLM, México): guarda site_id/moneda/idioma reales, no el default", async () => {
    const empresaId = await crearEmpresa("GUARDAR-SITE-ID-REAL");
    const cuentaIdExterna = cuentaIdExternaDePrueba();

    const resultado = await guardarCuentaConectada(empresaId, {
      cuentaIdExterna,
      nickname: "VENDEDOR_MEXICO",
      tokens: tokensDePrueba(cuentaIdExterna, "mx"),
      siteId: "MLM",
    });

    const [fila] = await dbComoEmpresa(empresaId, (tx) => tx.select().from(cuentasMl).where(eq(cuentasMl.id, resultado.id)));
    expect(fila.siteId).toBe("MLM");
    expect(fila.moneda).toBe("MXN");
    expect(fila.idioma).toBe("es-MX");
  });

  it("cuenta nueva SIN site_id (Mercado Libre no lo mandó): cae al default MCO/COP/es-CO, nunca null ni vacío", async () => {
    const empresaId = await crearEmpresa("GUARDAR-SITE-ID-DEFECTO");
    const cuentaIdExterna = cuentaIdExternaDePrueba();

    const resultado = await guardarCuentaConectada(empresaId, {
      cuentaIdExterna,
      nickname: "VENDEDOR_SIN_SITE_ID",
      tokens: tokensDePrueba(cuentaIdExterna, "sin-site"),
      siteId: null,
    });

    const [fila] = await dbComoEmpresa(empresaId, (tx) => tx.select().from(cuentasMl).where(eq(cuentasMl.id, resultado.id)));
    expect(fila.siteId).toBe("MCO");
    expect(fila.moneda).toBe("COP");
    expect(fila.idioma).toBe("es-CO");
  });

  it("reconectar con un site_id distinto al guardado (la cuenta cambió de país real): se actualiza, nunca se queda con el viejo", async () => {
    const empresaId = await crearEmpresa("RECONECTAR-SITE-ID-DISTINTO");
    const cuentaIdExterna = cuentaIdExternaDePrueba();

    const primera = await guardarCuentaConectada(empresaId, {
      cuentaIdExterna,
      nickname: "VENDEDOR_INICIAL",
      tokens: tokensDePrueba(cuentaIdExterna, "inicial"),
      siteId: "MCO",
    });
    await desconectarCuenta(empresaId, primera.id);

    await guardarCuentaConectada(empresaId, {
      cuentaIdExterna,
      nickname: "VENDEDOR_RECONECTADO",
      tokens: tokensDePrueba(cuentaIdExterna, "reconectado"),
      siteId: "MLB",
    });

    const [fila] = await dbComoEmpresa(empresaId, (tx) => tx.select().from(cuentasMl).where(eq(cuentasMl.id, primera.id)));
    expect(fila.siteId).toBe("MLB");
    expect(fila.moneda).toBe("BRL");
    expect(fila.idioma).toBe("pt-BR");
  });

  it("conectar, desconectar y reconectar la MISMA cuenta deja una sola fila activa con el mismo id (se conserva el histórico)", async () => {
    const empresaId = await crearEmpresa("RECONECTAR");
    const cuentaIdExterna = cuentaIdExternaDePrueba();

    const primera = await guardarCuentaConectada(empresaId, {
      cuentaIdExterna,
      nickname: "VENDEDOR_INICIAL",
      tokens: tokensDePrueba(cuentaIdExterna, "inicial"),
      siteId: null,
    });

    await desconectarCuenta(empresaId, primera.id);
    const [desconectada] = await dbComoEmpresa(empresaId, (tx) => tx.select().from(cuentasMl).where(eq(cuentasMl.id, primera.id)));
    expect(desconectada.desconectadaTs).not.toBeNull();

    const reconectada = await guardarCuentaConectada(empresaId, {
      cuentaIdExterna,
      nickname: "VENDEDOR_RECONECTADO",
      tokens: tokensDePrueba(cuentaIdExterna, "reconectado"),
      siteId: null,
    });

    // Mismo id — es justo lo que el INSERT simple de antes no podía
    // hacer (chocaba con el índice único en vez de reactivar).
    expect(reconectada.id).toBe(primera.id);

    const [fila] = await dbComoEmpresa(empresaId, (tx) => tx.select().from(cuentasMl).where(eq(cuentasMl.id, primera.id)));
    expect(fila.desconectadaTs).toBeNull();
    expect(fila.renovandoTs).toBeNull();
    expect(fila.nickname).toBe("VENDEDOR_RECONECTADO");
    expect(descifrarToken(fila.accessTokenCifrado)).toBe("access-reconectado");
    expect(descifrarToken(fila.refreshTokenCifrado)).toBe("refresh-reconectado");

    // Una sola fila activa para ese cuenta_id_externa — nunca una segunda.
    const todas = await dbComoEmpresa(empresaId, (tx) => tx.select({ id: cuentasMl.id }).from(cuentasMl).where(eq(cuentasMl.cuentaIdExterna, cuentaIdExterna)));
    expect(todas).toHaveLength(1);
  });

  it("reconectar sin haberse desconectado antes (ej. ML reenvía el mismo code) también reactiva la misma fila", async () => {
    const empresaId = await crearEmpresa("RECONECTAR-SIN-DESCONECTAR");
    const cuentaIdExterna = cuentaIdExternaDePrueba();
    const primera = await guardarCuentaConectada(empresaId, {
      cuentaIdExterna,
      nickname: "VENDEDOR_A",
      tokens: tokensDePrueba(cuentaIdExterna, "a"),
      siteId: null,
    });

    const segunda = await guardarCuentaConectada(empresaId, {
      cuentaIdExterna,
      nickname: "VENDEDOR_B",
      tokens: tokensDePrueba(cuentaIdExterna, "b"),
      siteId: null,
    });

    expect(segunda.id).toBe(primera.id);
    const todas = await dbComoEmpresa(empresaId, (tx) => tx.select({ id: cuentasMl.id }).from(cuentasMl).where(eq(cuentasMl.cuentaIdExterna, cuentaIdExterna)));
    expect(todas).toHaveLength(1);
  });

  it("cuenta_id_externa ya conectada a OTRA empresa: CuentaMlDeOtraEmpresaError, y nunca toca la fila ajena", async () => {
    const empresaAId = await crearEmpresa("OTRA-A");
    const empresaBId = await crearEmpresa("OTRA-B");
    const cuentaIdExterna = cuentaIdExternaDePrueba();

    const deEmpresaA = await guardarCuentaConectada(empresaAId, {
      cuentaIdExterna,
      nickname: "VENDEDOR_A",
      tokens: tokensDePrueba(cuentaIdExterna, "a"),
      siteId: null,
    });

    await expect(
      guardarCuentaConectada(empresaBId, {
        cuentaIdExterna,
        nickname: "INTENTO_DESDE_B",
        tokens: tokensDePrueba(cuentaIdExterna, "robo"),
        siteId: null,
      })
    ).rejects.toThrow(CuentaMlDeOtraEmpresaError);

    // El mensaje nunca revela a qué empresa pertenece.
    const error = await guardarCuentaConectada(empresaBId, {
      cuentaIdExterna,
      nickname: "INTENTO_DESDE_B",
      tokens: tokensDePrueba(cuentaIdExterna, "robo"),
      siteId: null,
    }).catch((e) => e);
    expect(error.message).not.toContain(empresaAId);
    expect(error.message).not.toContain("OTRA-A");

    // La fila real de la empresa A no cambió nada.
    const [filaA] = await dbComoEmpresa(empresaAId, (tx) => tx.select().from(cuentasMl).where(eq(cuentasMl.id, deEmpresaA.id)));
    expect(filaA.nickname).toBe("VENDEDOR_A");
    expect(descifrarToken(filaA.accessTokenCifrado)).toBe("access-a");

    // Y la empresa B nunca llegó a insertar ninguna fila con ese cuenta_id_externa.
    const todas = await dbComoEmpresa(empresaAId, (tx) => tx.select({ id: cuentasMl.id }).from(cuentasMl).where(eq(cuentasMl.cuentaIdExterna, cuentaIdExterna)));
    expect(todas).toHaveLength(1);
    expect(todas[0].id).toBe(deEmpresaA.id);
  });
});
