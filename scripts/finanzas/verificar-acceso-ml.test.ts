import { readFileSync } from "fs";
import path from "path";
import { describe, expect, it } from "vitest";
import {
  campoPresente,
  clasificarStatus,
  errorSeguro,
  esperaBackoffMs,
  formatearTablaResumen,
  hostDeConexion,
  idNumerico,
  llavesDeListaBlanca,
  validarEntorno,
  valorDeListaBlanca,
  LLAVES_COSTOS_CONOCIDAS,
  LOGISTIC_TYPES_CONOCIDOS,
  type ResultadoCuenta,
} from "./verificar-acceso-ml-logica";

// Z-FIN-00 (issue #122) — sin red y sin base: prueban las barreras del
// diagnóstico (confirmación obligatoria, nada de valores crudos en la
// salida, solo lectura).

const UUID = "11111111-2222-3333-4444-555555555555";

describe("verificar-acceso-ml — entorno", () => {
  it("sin CONFIRMO_SOLO_LECTURA=si no arranca", () => {
    const errores = validarEntorno({ AMBIENTE_CONFIRMADO: "staging", EMPRESA_ID: UUID, DATABASE_URL_APP: "x", ML_TOKEN_KEY_V1: "x" });
    expect(errores.join(" ")).toContain("CONFIRMO_SOLO_LECTURA=si");
  });

  it("CONFIRMO_SOLO_LECTURA con otro valor tampoco alcanza", () => {
    const errores = validarEntorno({ CONFIRMO_SOLO_LECTURA: "sí", AMBIENTE_CONFIRMADO: "staging", EMPRESA_ID: UUID, DATABASE_URL_APP: "x", ML_TOKEN_KEY_V1: "x" });
    expect(errores).toHaveLength(1);
  });

  it("sin AMBIENTE_CONFIRMADO=staging no arranca (revisión del PR #146)", () => {
    const base = { CONFIRMO_SOLO_LECTURA: "si", EMPRESA_ID: UUID, DATABASE_URL_APP: "x", ML_TOKEN_KEY_V1: "x" };
    expect(validarEntorno(base).join(" ")).toContain("AMBIENTE_CONFIRMADO=staging");
    expect(validarEntorno({ ...base, AMBIENTE_CONFIRMADO: "production" }).join(" ")).toContain("AMBIENTE_CONFIRMADO=staging");
  });

  it("hostDeConexion muestra solo el host, nunca usuario ni clave", () => {
    const host = hostDeConexion("postgres://app_user:clave-secreta@localhost:5433/railway");
    expect(host).toBe("localhost");
    expect(hostDeConexion("no es una url clave-secreta")).toBeNull();
    expect(hostDeConexion(undefined)).toBeNull();
  });

  it("EMPRESA_ID tiene que ser un UUID", () => {
    const errores = validarEntorno({ CONFIRMO_SOLO_LECTURA: "si", AMBIENTE_CONFIRMADO: "staging", EMPRESA_ID: "'; drop", DATABASE_URL_APP: "x", ML_TOKEN_KEY_V1: "x" });
    expect(errores.join(" ")).toContain("EMPRESA_ID");
  });

  it("los mensajes nombran variables, nunca su valor", () => {
    const errores = validarEntorno({ CONFIRMO_SOLO_LECTURA: "si", AMBIENTE_CONFIRMADO: "staging", EMPRESA_ID: UUID, DATABASE_URL_APP: "postgres://secreto" });
    expect(errores.join(" ")).not.toContain("secreto");
    expect(errores.join(" ")).toContain("ML_TOKEN_KEY_V1");
  });

  it("completo, no hay errores", () => {
    expect(validarEntorno({ CONFIRMO_SOLO_LECTURA: "si", AMBIENTE_CONFIRMADO: "staging", EMPRESA_ID: UUID, DATABASE_URL_APP: "x", ML_TOKEN_KEY_V1: "x" })).toEqual([]);
  });
});

describe("verificar-acceso-ml — clasificación y campos", () => {
  it("clasifica los códigos HTTP", () => {
    expect(clasificarStatus(200)).toBe("OK");
    expect(clasificarStatus(401)).toBe("falta permiso");
    expect(clasificarStatus(403)).toBe("falta permiso");
    expect(clasificarStatus(404)).toBe("no disponible");
    expect(clasificarStatus(429)).toBe("limitado (429)");
    expect(clasificarStatus(0)).toBe("sin respuesta");
    expect(clasificarStatus(500)).toBe("error");
  });

  it("campoPresente recorre listas y trata null/vacío como ausente", () => {
    const orden = { payments: [{ marketplace_fee: null }, { marketplace_fee: 1200 }], order_items: [{ item: { seller_sku: null } }] };
    expect(campoPresente(orden, "payments[].marketplace_fee")).toBe(true);
    expect(campoPresente(orden, "order_items[].item.seller_sku")).toBe(false);
    expect(campoPresente(orden, "shipping.id")).toBe(false);
    expect(campoPresente(null, "a.b")).toBe(false);
  });

  it("un logistic_type desconocido nunca sale con su valor crudo", () => {
    expect(valorDeListaBlanca("fulfillment", LOGISTIC_TYPES_CONOCIDOS)).toBe("fulfillment");
    expect(valorDeListaBlanca("<script>", LOGISTIC_TYPES_CONOCIDOS)).toBe("(valor nuevo)");
    expect(valorDeListaBlanca(null, LOGISTIC_TYPES_CONOCIDOS)).toBeNull();
  });

  it("las llaves de /costs se filtran con lista cerrada (revisión del PR #146)", () => {
    const costos = { senders: [], receiver: {}, nombre_raro_de_ml: 1, otro: 2 };
    const salida = llavesDeListaBlanca(costos, LLAVES_COSTOS_CONOCIDAS);
    expect(salida).toBe("senders/receiver, +2 no conocida(s)");
    expect(salida).not.toContain("nombre_raro_de_ml");
    expect(llavesDeListaBlanca(null, LLAVES_COSTOS_CONOCIDAS)).toBe("-");
  });

  it("idNumerico solo deja pasar dígitos (nunca texto pegado a una ruta)", () => {
    expect(idNumerico(2000003508419013)).toBe("2000003508419013");
    expect(idNumerico("123/../oauth")).toBeNull();
  });

  it("backoff crece 1s, 2s, 4s con jitter acotado", () => {
    expect(esperaBackoffMs(0, 0)).toBe(1000);
    expect(esperaBackoffMs(1, 0)).toBe(2000);
    expect(esperaBackoffMs(2, 1)).toBe(5200);
  });

  it("errorSeguro nunca devuelve el mensaje crudo", () => {
    expect(errorSeguro(new Error("postgres://usuario:clave@host"))).toBe("Error");
  });

  it("la tabla resumen tiene una fila por cuenta", () => {
    const celda = { estado: "OK" as const, detalle: "" };
    const cuenta: ResultadoCuenta = {
      etiqueta: "Cuenta 1",
      capacidades: { a: celda, b: celda, c: celda, d: { estado: "falta permiso", detalle: "" }, e: celda, f: celda },
      llamadas: 12,
      respuestas429: 1,
      msTotal: 3400,
      msMaximo: 800,
    };
    const tabla = formatearTablaResumen([cuenta]);
    expect(tabla.split("\n")).toHaveLength(3);
    expect(tabla).toContain("| Cuenta 1 | OK | OK | OK | falta permiso | OK | OK | 12 | 1 | 3400 | 800 |");
  });
});

describe("verificar-acceso-ml — solo lectura", () => {
  const fuente = readFileSync(path.join(__dirname, "verificar-acceso-ml.ts"), "utf8");

  it("no llama fetch directo: toda llamada a ML pasa por lib/ml/cliente.ts", () => {
    expect(fuente).not.toMatch(/\bfetch\(/);
    expect(fuente).toContain("leerParaDiagnostico");
  });

  it("no renueva tokens ni escribe en la base", () => {
    expect(fuente).not.toContain("obtenerAccessTokenVigente");
    expect(fuente).not.toMatch(/\.(insert|update|delete)\(/);
    expect(fuente).not.toMatch(/console\.log\([^)]*token\.token/);
  });

  it("la salida nunca usa el nickname de la tienda (revisión del PR #146)", () => {
    expect(fuente).not.toContain("cuenta.nickname");
    expect(fuente).not.toMatch(/Object\.keys\(/);
  });
});
