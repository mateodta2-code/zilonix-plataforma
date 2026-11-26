// Sonda de SOLO LECTURA (issue #422): averiguar si la API de Falabella
// Seller Center devuelve pagos, transacciones y cargos (comisión, envío,
// impuestos, publicidad) antes de diseñar Finanzas y Conciliación.
//
// Por qué existe: la documentación pública de Falabella no lista acciones
// de finanzas, pero la plataforma base (la misma de Jumia/Lazada) tiene
// GetPayoutStatus y GetTransactionDetails. En vez de adivinar (regla de
// CLAUDE.md), se preguntan a la API real y se guarda lo que responde.
//
// Qué NO hace: no escribe en la base, no crea migraciones, no llama
// ninguna acción que modifique algo en Falabella.
//
// Uso (desde la raíz del repo, con tsx para poder importar el .ts):
//   npx tsx scripts/falabella-sonda-pagos.mjs
// Variables de entorno: FALABELLA_USER_ID y FALABELLA_API_KEY (obligatorias),
// FALABELLA_SELLER_ID (opcional, solo va en el User-Agent).
//
// Seguridad: las credenciales nunca se imprimen ni se guardan. Las
// respuestas se redactan (datos personales del comprador) ANTES de
// escribirse en tmp/falabella-sonda/, que está en .gitignore.

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
// Se reutiliza la firma y el cliente real del conector — nada de
// duplicar el HMAC acá.
import { llamarFalabella, firmarSolicitud, FalabellaApiError, FalabellaNoDisponibleError } from "../lib/falabella/cliente.ts";

const DIR_SALIDA = join(process.cwd(), "tmp", "falabella-sonda");
const DIA_MS = 24 * 60 * 60 * 1000;
const MAX_PAGINAS = 10;
const LIMITE_PAGINA = 100;

const userId = process.env.FALABELLA_USER_ID;
const apiKey = process.env.FALABELLA_API_KEY;
const sellerId = process.env.FALABELLA_SELLER_ID || "ZILONIX";
if (!userId || !apiKey) {
  console.error("Faltan FALABELLA_USER_ID y/o FALABELLA_API_KEY en el entorno. No se llamó nada.");
  process.exit(1);
}
const credenciales = { userId, apiKey, sellerId };

// ── Redacción de datos personales ───────────────────────────────────
// Se tapa por NOMBRE de campo (todo el subárbol) y, aparte, cualquier
// valor que parezca correo. "Name" a secas no se tapa: en los ítems es
// el nombre del producto, que hace falta para entender la respuesta.
const CAMPO_PERSONAL =
  /customer|buyer|recipient|receiver|first.?name|last.?name|full.?name|address|street|phone|mobile|e.?mail|national|tax.?ident|document|cedula|legal|fiscal|verifier|remarks|gift.?message|ward|post.?code|zip|city|region|latitude|longitude/i;
const PARECE_CORREO = /[^\s@]+@[^\s@]+\.[^\s@]+/;

function redactar(valor) {
  if (Array.isArray(valor)) return valor.map(redactar);
  if (valor && typeof valor === "object") {
    const salida = {};
    for (const [clave, v] of Object.entries(valor)) {
      salida[clave] = CAMPO_PERSONAL.test(clave) && v !== null && v !== "" ? "[REDACTADO]" : redactar(v);
    }
    return salida;
  }
  if (typeof valor === "string" && PARECE_CORREO.test(valor)) return "[REDACTADO]";
  return valor;
}

// ── Resumen: nombres de campos + 1 ejemplo de monto + banderas ─────
const BANDERAS = {
  comision: /commission|comision|fee/i,
  envio: /shipping|envio|delivery|freight/i,
  impuestos: /tax|vat|iva|impuesto/i,
  publicidad: /advert|\bads?\b|sponsor|marketing|publicidad|campaign/i,
  fecha_pago: /(paid|payout|payment|settle\w*).?(at|date|on|time)|fecha.?pago/i,
  estado_pago: /(payout|payment|paid|settle\w*).?status|estado.?pago|^paid$/i,
  estado_cuenta: /statement|estado.?de.?cuenta/i,
};
const CAMPO_MONTO = /amount|price|fee|commission|tax|total|value|paid|shipping|balance|payout/i;

function recolectarCampos(valor, prefijo, campos) {
  if (Array.isArray(valor)) {
    for (const item of valor) recolectarCampos(item, `${prefijo}[]`, campos);
  } else if (valor && typeof valor === "object") {
    for (const [clave, v] of Object.entries(valor)) {
      const ruta = prefijo ? `${prefijo}.${clave}` : clave;
      if (v && typeof v === "object") recolectarCampos(v, ruta, campos);
      else if (!campos.has(ruta)) campos.set(ruta, v);
    }
  }
  return campos;
}

function resumir(cuerpo) {
  const campos = recolectarCampos(cuerpo, "", new Map());
  const nombres = [...campos.keys()];
  let ejemploMonto = null;
  for (const [ruta, v] of campos) {
    const hoja = ruta.split(".").pop();
    if (CAMPO_MONTO.test(hoja) && v !== null && v !== "" && !Number.isNaN(Number(v))) {
      ejemploMonto = { campo: ruta, valor: v };
      break;
    }
  }
  const banderas = {};
  for (const [nombre, regex] of Object.entries(BANDERAS)) {
    const coincide = nombres.filter((r) => regex.test(r.split(".").pop()));
    if (coincide.length) banderas[nombre] = coincide;
  }
  return { campos: nombres, ejemploMonto, banderas };
}

// ── Llamadas ────────────────────────────────────────────────────────
async function intentar(action, version, parametros) {
  try {
    const cuerpo = await llamarFalabella({ ...credenciales, action, version, parametros });
    return { ok: true, parametros, cuerpo: cuerpo ?? null };
  } catch (error) {
    // Primera corrida real (18/11): GetPayoutStatus y GetTransactionDetails
    // dieron FalabellaApiError "desconocido" — el ErrorResponse no traía
    // ErrorCode/ErrorMessage donde cliente.ts los busca. Se repite la
    // llamada en crudo (misma firma) para guardar el ErrorResponse tal cual.
    if (error instanceof FalabellaApiError && error.codigo === "desconocido") {
      return { ok: false, parametros, error: { tipo: error.name, codigo: null, mensaje: error.message }, errorCrudo: await errorCrudo(action, version, parametros) };
    }
    if (error instanceof FalabellaApiError || error instanceof FalabellaNoDisponibleError) {
      return { ok: false, parametros, error: { tipo: error.name, codigo: error.codigo ?? null, mensaje: error.message } };
    }
    return { ok: false, parametros, error: { tipo: "inesperado", mensaje: error instanceof Error ? error.message : String(error) } };
  }
}

async function errorCrudo(action, version, parametros) {
  const base = { Action: action, Format: "JSON", Timestamp: new Date().toISOString(), UserID: userId, Version: version, ...parametros };
  const query = new URLSearchParams({ ...base, Signature: firmarSolicitud(base, apiKey) });
  try {
    const res = await fetch(`https://sellercenter-api.falabella.com/?${query}`, {
      headers: { "User-Agent": `${sellerId}/Node/${process.versions.node.split(".")[0]}/ZILONIX/FACO` },
      signal: AbortSignal.timeout(15_000),
      redirect: "error",
    });
    const cuerpo = await res.json().catch(() => null);
    return { status: res.status, ErrorResponse: cuerpo?.ErrorResponse ?? cuerpo };
  } catch (e) {
    return { fallo: e instanceof Error ? e.message : "error de red" };
  }
}

// La plataforma base no documenta en Falabella los nombres exactos de
// parámetros de finanzas: se prueban variantes en orden y se guardan
// TODOS los intentos, para que la evidencia diga cuál aceptó.
async function intentarVariantes(action, version, variantes) {
  const intentos = [];
  for (const parametros of variantes) {
    const r = await intentar(action, version, parametros);
    intentos.push(r);
    if (r.ok) break;
  }
  return intentos;
}

// Primer arreglo que aparezca en el cuerpo — para saber si hay que paginar
// sin suponer la forma exacta de la respuesta.
function primerArreglo(valor) {
  if (Array.isArray(valor)) return valor;
  if (valor && typeof valor === "object") {
    for (const v of Object.values(valor)) {
      const a = primerArreglo(v);
      if (a) return a;
    }
  }
  return null;
}

function guardar(nombre, datos) {
  writeFileSync(join(DIR_SALIDA, `${nombre}.json`), JSON.stringify(redactar(datos), null, 2));
}

const iso = (ms) => new Date(ms).toISOString();
const soloFecha = (ms) => iso(ms).slice(0, 10);

// llamarFalabella solo reporta el NOMBRE del error de red ("TypeError"),
// sin la causa. Primera corrida real (18/11): todas las llamadas dieron
// "TypeError" sin más pista. Esta prueba previa, SIN credenciales ni
// firma, repite las mismas opciones de fetch y muestra la causa real.
async function diagnosticarRed() {
  try {
    const res = await fetch("https://sellercenter-api.falabella.com/", {
      headers: { "User-Agent": `${sellerId}/Node/${process.versions.node.split(".")[0]}/ZILONIX/FACO` },
      signal: AbortSignal.timeout(15_000),
      redirect: "error",
      cache: "no-store",
    });
    console.log(`Conexión con Falabella OK (respondió ${res.status}).`);
    return true;
  } catch (error) {
    const causa = error?.cause;
    console.error(
      "No se pudo conectar con Falabella:",
      error?.name,
      "-",
      error?.message,
      causa ? `| causa: ${causa.code ?? ""} ${causa.message ?? ""}` : "",
    );
    return false;
  }
}

async function main() {
  if (!(await diagnosticarRed())) process.exit(1);
  mkdirSync(DIR_SALIDA, { recursive: true });
  const ahora = Date.now();
  const resumen = {};

  function registrar(nombre, intentos) {
    const exitoso = intentos.find((i) => i.ok);
    guardar(nombre, { intentos });
    resumen[nombre] = exitoso
      ? { estado: "OK", parametros: Object.keys(exitoso.parametros), ...resumir(exitoso.cuerpo) }
      : { estado: "ERROR", errores: intentos.map((i) => ({ ...i.error, ...(i.errorCrudo ? { crudo: i.errorCrudo } : {}) })) };
  }

  // 1) GetPayoutStatus — últimos 60 días.
  registrar(
    "GetPayoutStatus",
    await intentarVariantes("GetPayoutStatus", "1.0", [{ CreatedAfter: iso(ahora - 60 * DIA_MS) }]),
  );

  // 2) GetTransactionDetails — últimos 30 días, paginado con Offset.
  const variantesTx = [
    { StartTime: iso(ahora - 30 * DIA_MS), EndTime: iso(ahora) },
    { StartTime: soloFecha(ahora - 30 * DIA_MS), EndTime: soloFecha(ahora) },
    { CreatedAfter: iso(ahora - 30 * DIA_MS), CreatedBefore: iso(ahora) },
  ].map((p) => ({ ...p, Limit: String(LIMITE_PAGINA), Offset: "0" }));
  const intentosTx = await intentarVariantes("GetTransactionDetails", "1.0", variantesTx);
  const primeraTx = intentosTx.find((i) => i.ok);
  if (primeraTx) {
    let pagina = primerArreglo(primeraTx.cuerpo);
    for (let n = 1; n < MAX_PAGINAS && pagina && pagina.length === LIMITE_PAGINA; n++) {
      const r = await intentar("GetTransactionDetails", "1.0", { ...primeraTx.parametros, Offset: String(n * LIMITE_PAGINA) });
      intentosTx.push(r);
      if (!r.ok) break;
      pagina = primerArreglo(r.cuerpo);
    }
  }
  registrar("GetTransactionDetails", intentosTx);

  // 3) Dos órdenes recientes (GetOrders v2.0, como en lib/falabella/pedidos.ts).
  const ordenes = await intentar("GetOrders", "2.0", { CreatedAfter: iso(ahora - 30 * DIA_MS), Limit: "2", SortDirection: "DESC" });
  let ids = [];
  if (ordenes.ok) {
    const o = ordenes.cuerpo?.Orders?.Order;
    ids = (Array.isArray(o) ? o : o ? [o] : []).map((x) => String(x.OrderId)).slice(0, 2);
  }
  if (!ids.length) {
    // SortDirection podría no existir: se reintenta sin él y se toman las 2 últimas.
    const sinOrden = await intentar("GetOrders", "2.0", { CreatedAfter: iso(ahora - 30 * DIA_MS), Limit: "100" });
    if (sinOrden.ok) {
      const o = sinOrden.cuerpo?.Orders?.Order;
      ids = (Array.isArray(o) ? o : o ? [o] : []).map((x) => String(x.OrderId)).slice(-2);
    }
  }

  if (!ids.length) {
    resumen.GetOrder = resumen.GetOrderItems = resumen.GetMultipleOrderItems = {
      estado: "OMITIDO",
      motivo: "GetOrders no devolvió órdenes en los últimos 30 días.",
    };
  } else {
    for (const [i, id] of ids.entries()) {
      registrar(`GetOrder-${i + 1}`, [await intentar("GetOrder", "1.0", { OrderId: id })]);
      registrar(`GetOrderItems-${i + 1}`, [await intentar("GetOrderItems", "1.0", { OrderId: id })]);
    }
    registrar("GetMultipleOrderItems", await intentarVariantes("GetMultipleOrderItems", "1.0", [{ OrderIdList: `[${ids.join(",")}]` }]));
  }

  // El resumen solo trae nombres de campos, un monto de ejemplo y
  // banderas — igual pasa por redactar() por si acaso.
  guardar("resumen", resumen);
  for (const [nombre, r] of Object.entries(resumen)) {
    console.log(`\n=== ${nombre}: ${r.estado}`);
    if (r.estado === "ERROR") {
      for (const e of r.errores) console.log("  error:", e.crudo ? JSON.stringify(redactar(e.crudo)) : `${e.codigo ?? e.tipo}: ${e.mensaje}`);
    }
    if (r.estado === "OK") {
      console.log(`  parámetros aceptados: ${r.parametros.join(", ")}`);
      console.log(`  campos (${r.campos.length}): ${r.campos.join(", ")}`);
      console.log("  ejemplo de monto:", r.ejemploMonto ? `${r.ejemploMonto.campo} = ${r.ejemploMonto.valor}` : "ninguno");
      console.log("  banderas:", Object.keys(r.banderas).length ? JSON.stringify(r.banderas) : "ninguna");
    }
    if (r.motivo) console.log(`  ${r.motivo}`);
  }
  console.log(`\nRespuestas redactadas en ${DIR_SALIDA}`);
}

main().catch((error) => {
  // Nunca se imprime el objeto completo: podría arrastrar la URL firmada.
  console.error("La sonda falló:", error instanceof Error ? error.message : "error desconocido");
  process.exit(1);
});
